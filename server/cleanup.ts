import type { PaseoApi } from "@getpaseo/client";
import type { CleanupJob } from "../shared/contracts";

const CLEANUP_TIMEOUT_MS = 60 * 60 * 1000;
const FINISHED_RETENTION_MS = 10 * 60 * 1000;

const jobs = new Map<string, CleanupJob>();

function update(agentId: string, patch: Partial<CleanupJob>) {
  const current = jobs.get(agentId);
  if (current) jobs.set(agentId, { ...current, ...patch, updatedAt: new Date().toISOString() });
}

interface ChildAgent {
  title?: string | null;
  workspaceId?: string | null;
  labels?: Record<string, string>;
  status: string;
}

function isIndependentRun(agent: ChildAgent, parentWorkspaceId: string | null): boolean {
  if (agent.labels?.["agent-board.item"] || agent.labels?.["agent-board.intake"]) return true;
  if (/\b(deliver|scratch|intake)\b/i.test(agent.title ?? "") && /#\d+/.test(agent.title ?? "")) return true;
  return Boolean(agent.workspaceId && agent.workspaceId !== parentWorkspaceId && agent.status === "running");
}

async function archiveEmptyWorkspaces(paseo: PaseoApi, workspaceIds: readonly string[]) {
  if (!workspaceIds.length) return [];
  const { entries } = await paseo.agents.list({});
  const busy = new Set(entries.filter(({ agent }) => !agent.archivedAt).map(({ agent }) => agent.workspaceId));
  const archived: string[] = [];
  for (const workspaceId of new Set(workspaceIds)) {
    if (busy.has(workspaceId)) continue;
    await paseo.workspaces.archive(workspaceId);
    archived.push(workspaceId);
  }
  return archived;
}

async function run(paseo: PaseoApi, agentId: string, prompt: string | null) {
  try {
    const handle = paseo.agents.ref(agentId);
    const snapshot = (await handle.refresh())?.agent ?? null;
    const workspaceIds = new Set<string>();
    if (snapshot?.workspaceId) workspaceIds.add(snapshot.workspaceId);
    const { entries: children } = await paseo.agents.list({ filter: { labels: { "paseo.parent-agent-id": agentId } } });
    const entries = children.filter(({ agent }) => !isIndependentRun(agent, snapshot?.workspaceId ?? null));
    const kept = children.length - entries.length;
    for (const { agent } of entries) if (agent.workspaceId) workspaceIds.add(agent.workspaceId);

    if (prompt) {
      update(agentId, { state: "cleaning", message: "Агент прибирается" });
      const result = await handle.run(prompt, { timeoutMs: CLEANUP_TIMEOUT_MS });
      if (result.status === "permission") {
        update(agentId, { state: "needs-you", message: "Cleanup ждёт разрешения; разрешите и нажмите архивировать снова" });
        return;
      }
      if (result.status !== "idle") {
        update(agentId, { state: "failed", message: result.error ?? `Cleanup завершился со статусом ${result.status}` });
        return;
      }
      update(agentId, { report: result.lastMessage?.slice(0, 4000) ?? null });
    }

    update(agentId, { state: "archiving", message: "Архивирую" });
    for (const { agent } of entries) if (!agent.archivedAt) await paseo.agents.ref(agent.id).archive();
    await handle.archive();
    const archived = await archiveEmptyWorkspaces(paseo, [...workspaceIds]);
    const keptNote = kept ? `; оставлены работающими follow-up координаторы: ${kept}` : "";
    update(agentId, {
      state: "done",
      message: (archived.length ? `Агент и воркспейсы (${archived.length}) архивированы` : "Агент архивирован") + keptNote,
    });
  } catch (error) {
    update(agentId, { state: "failed", message: (error as Error).message });
  }
}

export function startCleanup(paseo: PaseoApi, agentId: string, prompt: string | null) {
  const current = jobs.get(agentId);
  if (current && (current.state === "cleaning" || current.state === "archiving")) return { job: current };
  const now = new Date().toISOString();
  const job: CleanupJob = { agentId, state: "cleaning", message: prompt ? "Отправляю cleanup" : "Архивирую", report: null, startedAt: now, updatedAt: now };
  jobs.set(agentId, job);
  void run(paseo, agentId, prompt);
  return { job };
}

export async function archiveTask(
  paseo: PaseoApi,
  agentIds: readonly string[],
  workspaceIds: readonly string[],
  prompt: string | null,
) {
  const started = agentIds.map((agentId) => startCleanup(paseo, agentId, prompt).job);
  const archived = await archiveEmptyWorkspaces(paseo, workspaceIds);
  return { jobs: started, archivedWorkspaces: archived.length };
}

export function cleanupJobs() {
  const now = Date.now();
  for (const [agentId, job] of jobs) {
    if ((job.state === "done" || job.state === "failed") && now - Date.parse(job.updatedAt) > FINISHED_RETENTION_MS) jobs.delete(agentId);
  }
  return { jobs: [...jobs.values()] };
}
