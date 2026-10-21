import type { Repo, RunState } from "./contracts";

export const PARENT_LABEL = "paseo.parent-agent-id";
export const ITEM_LABEL = "agent-board.item";
export const ACTION_LABEL = "agent-board.action";
export const INTAKE_LABEL = "agent-board.intake";

export interface BoardAgent {
  id: string;
  workspaceId: string | null;
  provider: string;
  model: string | null;
  cwd: string;
  title: string | null;
  status: string;
  updatedAt: string;
  createdAt: string;
  requiresAttention: boolean;
  attentionReason: string | null;
  pendingPermissions: number;
  lastError: string | null;
  labels: Record<string, string>;
}

export interface BoardWorkspace {
  id: string;
  title: string | null;
  name: string;
  directory: string;
  branch: string | null;
  status: string;
  pinnedAt: string | null;
  activityAt: string | null;
  statusEnteredAt: string | null;
  kind: string;
}

export type Bucket = "active" | "needs" | "done";
export type Tone = "running" | "danger" | "waiting" | "idle" | "done";

export interface Task {
  agent: BoardAgent;
  workspace: BoardWorkspace | null;
  repo: Repo | null;
  repoName: string;
  number: number | null;
  label: string;
  run: RunState | null;
  workers: BoardAgent[];
  parentAgentId: string | null;
  bucket: Bucket;
  tone: Tone;
  statusText: string;
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function isInside(root: string, path: string): boolean {
  return path === root || path.startsWith(root + "/");
}

export function ownerPath(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.search(/\/\.(worktrees|claude\/worktrees)\//);
  return index === -1 ? normalized : normalized.slice(0, index);
}

export function findRepo(repos: readonly Repo[], cwd: string): Repo | null {
  const owner = ownerPath(cwd);
  let best: Repo | null = null;
  for (const repo of repos) {
    const root = ownerPath(repo.path);
    if (isInside(root, owner) && (!best || root.length > ownerPath(best.path).length)) best = repo;
  }
  return best;
}

const DELIVER_TITLE = /^Deliver\s+(\S+)\s+#(\d+)(?:[,+\s#\d]*)\((.+)\)\s*$/;

export function parseDeliverTitle(title: string | null | undefined) {
  const match = title ? DELIVER_TITLE.exec(title) : null;
  return match ? { repoName: match[1], number: Number(match[2]), summary: match[3] } : null;
}

const LOOSE_NUMBER = /#(\d{2,})\b/;
const GITHUB_URL = /github\.com\/[^/\s]+\/([^/\s]+)\/(?:pull|issues)\/(\d+)/;

function resolveRepo(repos: readonly Repo[], agent: BoardAgent, workers: readonly BoardAgent[], titleRepo: string | null) {
  const own = findRepo(repos, agent.cwd);
  if (own?.kind === "git") return own;
  const wanted = titleRepo?.toLowerCase().replace(/[^a-z0-9]/g, "");
  const named = wanted
    ? repos.find((repo) =>
        [repo.name, repo.github?.split("/")[1] ?? ""].some((name) => name.toLowerCase().replace(/[^a-z0-9]/g, "") === wanted),
      )
    : undefined;
  if (named) return named;
  const votes = new Map<Repo, number>();
  for (const worker of workers) {
    const repo = findRepo(repos, worker.cwd);
    if (repo?.kind === "git") votes.set(repo, (votes.get(repo) ?? 0) + 1);
  }
  let best: Repo | null = null;
  for (const [repo, count] of votes) if (!best || count > (votes.get(best) ?? 0)) best = repo;
  return best ?? own;
}

function repoShortName(repo: string | null): string | null {
  return repo ? (repo.split("/").pop() ?? repo) : null;
}

function matchRun(agent: BoardAgent, repoName: string, number: number | null, runs: readonly RunState[]): RunState | null {
  const byAgent = runs.find((run) => run.coordinatorAgentId === agent.id);
  if (byAgent) return byAgent;
  if (number === null) return null;
  const candidates = runs.filter(
    (run) =>
      repoShortName(run.repo)?.toLowerCase() === repoName.toLowerCase() &&
      (run.number === number || run.pr === number) &&
      !run.coordinatorAgentId,
  );
  return candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

function classify(agent: BoardAgent, run: RunState | null): Pick<Task, "bucket" | "tone" | "statusText"> {
  if (agent.pendingPermissions > 0 || agent.attentionReason === "permission") {
    return { bucket: "needs", tone: "danger", statusText: "Needs permission" };
  }
  if (agent.status === "error" || agent.attentionReason === "error") {
    return { bucket: "needs", tone: "danger", statusText: agent.lastError ? "Error" : "Failed" };
  }
  if (run?.needsUser && run.state !== "final") {
    return { bucket: "needs", tone: "waiting", statusText: "Question for you" };
  }
  if (agent.status === "running" || agent.status === "initializing") {
    return { bucket: "active", tone: "running", statusText: "Running" };
  }
  if (run?.state === "final") {
    return { bucket: "done", tone: "done", statusText: run.result ?? "Finished" };
  }
  if (run?.state === "blocked") {
    return { bucket: "needs", tone: "waiting", statusText: run.blocker ? "Blocked" : "Waiting" };
  }
  if (agent.status === "closed") {
    return { bucket: "done", tone: "done", statusText: "Closed" };
  }
  if (agent.requiresAttention) {
    return { bucket: "active", tone: "waiting", statusText: "Waiting" };
  }
  return { bucket: "active", tone: "idle", statusText: "Idle" };
}

export interface BuildInput {
  agents: readonly BoardAgent[];
  workspaces: ReadonlyMap<string, BoardWorkspace>;
  repos: readonly Repo[];
  rootPath: string | null;
  rootName: string;
  runs: readonly RunState[];
}

function deliverNumber(agent: BoardAgent, workspace: BoardWorkspace | null): number | null {
  const label = agent.labels[ITEM_LABEL];
  const fromLabel = label ? /#(\d+)$/.exec(label) : null;
  if (fromLabel) return Number(fromLabel[1]);
  const fromTitle = parseDeliverTitle(workspace?.title) ?? parseDeliverTitle(agent.title);
  if (fromTitle) return fromTitle.number;
  const loose = /\bdeliver\b[^#]*#(\d+)/i.exec(agent.title ?? "");
  return loose ? Number(loose[1]) : null;
}

export function buildTasks({ agents, workspaces, repos, rootPath, rootName, runs }: BuildInput): Task[] {
  const root = rootPath ? normalizePath(rootPath) : null;
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const workspaceOf = (agent: BoardAgent) => (agent.workspaceId ? (workspaces.get(agent.workspaceId) ?? null) : null);
  const promoted = new Set<string>();
  for (const agent of agents) {
    const parentId = agent.labels[PARENT_LABEL];
    const parent = parentId ? byId.get(parentId) : undefined;
    if (!parent) continue;
    const own = deliverNumber(agent, agent.workspaceId !== parent.workspaceId ? workspaceOf(agent) : null);
    const runOwned = runs.some((run) => run.coordinatorAgentId === agent.id && run.kind !== "scratch");
    if ((own !== null && own !== deliverNumber(parent, workspaceOf(parent))) || runOwned) promoted.add(agent.id);
  }
  const children = new Map<string, BoardAgent[]>();
  for (const agent of agents) {
    const parent = agent.labels[PARENT_LABEL];
    if (!parent || promoted.has(agent.id)) continue;
    children.set(parent, [...(children.get(parent) ?? []), agent]);
  }
  const workers = new Map<string, BoardAgent[]>();
  const descendants = (id: string, seen = new Set<string>()): BoardAgent[] => {
    if (seen.has(id)) return [];
    seen.add(id);
    return (children.get(id) ?? []).flatMap((child) => [child, ...descendants(child.id, seen)]);
  };
  for (const agent of agents) workers.set(agent.id, descendants(agent.id));
  const ids = new Set(agents.map((agent) => agent.id));
  const tasks: Task[] = [];
  for (const agent of agents) {
    const parent = agent.labels[PARENT_LABEL];
    if (parent && ids.has(parent) && !promoted.has(agent.id)) continue;
    if (root && !isInside(root, normalizePath(agent.cwd))) continue;
    const workspace = agent.workspaceId ? (workspaces.get(agent.workspaceId) ?? null) : null;
    const taskWorkers = workers.get(agent.id) ?? [];
    const deliverLabel = agent.labels[ITEM_LABEL];
    const fromLabel = deliverLabel ? /#(\d+)$/.exec(deliverLabel) : null;
    const fromTitle = parseDeliverTitle(workspace?.title) ?? parseDeliverTitle(agent.title);
    const fromUrl = GITHUB_URL.exec(agent.title ?? "");
    const repo = resolveRepo(repos, agent, taskWorkers, fromTitle?.repoName ?? fromUrl?.[1] ?? null);
    const repoName = repo?.name ?? fromTitle?.repoName ?? rootName;
    const loose = LOOSE_NUMBER.exec(agent.title ?? "") ?? LOOSE_NUMBER.exec(workspace?.title ?? "");
    const number = fromLabel ? Number(fromLabel[1]) : (fromTitle?.number ?? (fromUrl ? Number(fromUrl[2]) : loose ? Number(loose[1]) : null));
    const run = matchRun(agent, repoName, number, runs);
    const effectiveNumber = run?.pr ?? run?.number ?? number;
    const summary = run?.title ?? fromTitle?.summary ?? agent.title ?? workspace?.title ?? "Untitled agent";
    const label =
      effectiveNumber !== null
        ? `${repoName} #${effectiveNumber}  ${summary.replace(`#${effectiveNumber}`, "").replace(/\s{2,}/g, " ").trim()}`
        : `${repoName}  ${summary}`;
    tasks.push({
      agent,
      workspace,
      repo,
      repoName,
      number: effectiveNumber,
      label,
      run,
      parentAgentId: promoted.has(agent.id) ? (agent.labels[PARENT_LABEL] ?? null) : null,
      workers: taskWorkers.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      ...classify(agent, run),
    });
  }
  return tasks.sort((a, b) => latestActivity(b).localeCompare(latestActivity(a)));
}

export function latestActivity(task: Task): string {
  let latest = task.agent.updatedAt;
  for (const worker of task.workers) if (worker.updatedAt > latest) latest = worker.updatedAt;
  if (task.run && task.run.updatedAt > latest) latest = task.run.updatedAt;
  return latest;
}

export function formatAge(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
