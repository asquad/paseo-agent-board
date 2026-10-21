import type { PaseoAgent, PaseoWorkspace } from "@getpaseo/client";
import { usePaseo, useRpc, useSettings } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { agentReposRpc, boardSettings, cleanupJobsRpc, listAssignmentsRpc, listDismissedRpc, listNotesRpc, itemKey, listTodosRpc, lookupItemsRpc, reposRpc, runsRpc, type Item } from "../shared/contracts";
import { buildWork, workMetaKeys } from "../shared/work";
import { buildTasks, INTAKE_LABEL, type BoardAgent, type BoardWorkspace } from "../shared/model";

function errorText(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && "message" in value && typeof value.message === "string") return value.message;
  return JSON.stringify(value);
}

export function toBoardAgent(agent: PaseoAgent): BoardAgent {
  return {
    id: agent.id,
    workspaceId: agent.workspaceId ?? null,
    provider: agent.provider,
    model: agent.model ?? null,
    cwd: agent.cwd,
    title: agent.title ?? null,
    status: agent.status,
    updatedAt: agent.updatedAt,
    createdAt: agent.createdAt,
    requiresAttention: agent.requiresAttention ?? false,
    attentionReason: agent.attentionReason ?? null,
    pendingPermissions: agent.pendingPermissions?.length ?? 0,
    lastError: errorText(agent.lastError),
    labels: agent.labels ?? {},
  };
}

function toBoardWorkspace(workspace: PaseoWorkspace): BoardWorkspace {
  return {
    id: workspace.id,
    title: workspace.title ?? null,
    name: workspace.name,
    directory: workspace.workspaceDirectory,
    branch: workspace.project?.checkout.currentBranch ?? null,
    status: workspace.status,
    pinnedAt: workspace.pinnedAt ?? null,
    activityAt: workspace.activityAt ?? null,
    statusEnteredAt: workspace.statusEnteredAt ?? null,
    kind: workspace.workspaceKind,
  };
}

export function useLiveAgents() {
  const paseo = usePaseo();
  const [agents, setAgents] = useState<ReadonlyMap<string, BoardAgent>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const lifetime = new AbortController();
    let release: (() => void) | undefined;
    paseo.agents
      .list({ subscribe: {}, signal: lifetime.signal })
      .then(({ subscription }) => {
        if (lifetime.signal.aborted) return undefined;
        release = subscription.subscribe({
          snapshot: ({ entries }) => {
            setAgents(
              new Map(
                entries.filter(({ agent }) => !agent.archivedAt).map(({ agent }) => [agent.id, toBoardAgent(agent)]),
              ),
            );
            setLoaded(true);
            setError(null);
          },
          update: (message) => {
            if (message.type !== "agent_update") return;
            const update = message.payload;
            setAgents((previous) => {
              const next = new Map(previous);
              if (update.kind === "upsert" && !update.agent.archivedAt) next.set(update.agent.id, toBoardAgent(update.agent));
              else next.delete(update.kind === "upsert" ? update.agent.id : update.agentId);
              return next;
            });
          },
          error: (reason) => setError(errorText(reason) ?? "Agent subscription failed"),
        });
        return undefined;
      })
      .catch((reason: unknown) => {
        if (!lifetime.signal.aborted) setError(errorText(reason) ?? "Could not list agents");
      });
    return () => {
      lifetime.abort();
      release?.();
    };
  }, [paseo]);

  return { agents, loaded, error };
}

export function useBoard() {
  const paseo = usePaseo();
  const settings = useSettings(boardSettings);
  const revision = settings.status === "ready" ? settings.revision : null;
  const listRepos = useRpc(reposRpc);
  const listRuns = useRpc(runsRpc);
  const listTodos = useRpc(listTodosRpc);
  const lookup = useRpc(lookupItemsRpc);
  const scanRepos = useRpc(agentReposRpc);
  const listAssignments = useRpc(listAssignmentsRpc);
  const live = useLiveAgents();

  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const { entries } = await paseo.workspaces.list({});
      return new Map(entries.map((entry) => [entry.id, toBoardWorkspace(entry)]));
    },
    refetchInterval: 10_000,
  });
  const repos = useQuery({
    queryKey: ["repos", revision],
    queryFn: () => listRepos({}),
    enabled: revision !== null,
    refetchInterval: 60_000,
  });
  const runs = useQuery({
    queryKey: ["runs", revision],
    queryFn: () => listRuns({}),
    enabled: revision !== null,
    refetchInterval: 5_000,
  });

  const tasks = useMemo(
    () =>
      buildTasks({
        agents: [...live.agents.values()],
        workspaces: workspaces.data ?? new Map(),
        repos: repos.data?.repos ?? [],
        rootPath: repos.data?.rootPath ?? null,
        rootName: repos.data?.rootName ?? "",
        runs: runs.data?.runs ?? [],
      }),
    [live.agents, workspaces.data, repos.data, runs.data],
  );

  const todos = useQuery({ queryKey: ["todos"], queryFn: () => listTodos({}), refetchInterval: 30_000 });
  const assignments = useQuery({ queryKey: ["assignments"], queryFn: () => listAssignments({}) });
  const assignmentMap = useMemo(
    () => new Map((assignments.data?.assignments ?? []).map((assignment) => [assignment.workspaceId, assignment])),
    [assignments.data],
  );
  const scanTargets = useMemo(
    () =>
      tasks
        .filter((task) => task.repo?.kind !== "git" || task.number === null)
        .flatMap((task) => [task.agent, ...task.workers])
        .map((agent) => ({ id: agent.id, updatedAt: agent.updatedAt })),
    [tasks],
  );
  const latestTargets = useRef(scanTargets);
  latestTargets.current = scanTargets;
  const scanIds = scanTargets.map((target) => target.id).sort().join(",");
  const scanned = useQuery({
    queryKey: ["agent-repos", scanIds],
    queryFn: () => scanRepos({ agents: latestTargets.current }),
    enabled: scanIds.length > 0 && repos.data !== undefined,
    placeholderData: (previous) => previous,
    refetchInterval: 60_000,
  });
  const intakeAgents = useMemo(
    () =>
      new Set([
        ...tasks.filter((task) => task.agent.labels[INTAKE_LABEL]).map((task) => task.agent.id),
        ...(runs.data?.runs ?? []).flatMap((run) => (run.kind === "scratch" && run.coordinatorAgentId ? [run.coordinatorAgentId] : [])),
      ]),
    [tasks, runs.data],
  );
  const metaKeys = useMemo(
    () => workMetaKeys(
        tasks,
        runs.data?.runs ?? [],
        todos.data?.todos ?? [],
        workspaces.data ?? new Map(),
        repos.data?.repos ?? [],
        [
          ...(assignments.data?.assignments ?? []).flatMap((assignment) => (assignment.link ? [assignment.link] : [])),
          ...(scanned.data?.results ?? []).flatMap((result) => (intakeAgents.has(result.id) ? result.links : [])),
        ],
      ),
    [tasks, runs.data, todos.data, workspaces.data, repos.data, assignments.data, scanned.data, intakeAgents],
  );
  const meta = useQuery({
    queryKey: ["meta", metaKeys.join(",")],
    queryFn: () => lookup({ keys: metaKeys }),
    enabled: metaKeys.length > 0,
    placeholderData: (previous) => previous,
    refetchInterval: 5 * 60_000,
  });
  const metaMap = useMemo(() => {
    const map = new Map<string, Item>();
    for (const item of meta.data?.items ?? []) map.set(itemKey(item.repo, item.number), item);
    return map;
  }, [meta.data]);
  const agentRepoMap = useMemo(
    () => new Map((scanned.data?.results ?? []).map((result) => [result.id, result.repos])),
    [scanned.data],
  );
  const agentLinkMap = useMemo(
    () => new Map((scanned.data?.results ?? []).map((result) => [result.id, result.links])),
    [scanned.data],
  );
  const workItems = useMemo(
    () =>
      buildWork({
        tasks,
        runs: runs.data?.runs ?? [],
        todos: todos.data?.todos ?? [],
        meta: metaMap,
        workspaces: workspaces.data ?? new Map(),
        repos: repos.data?.repos ?? [],
        rootPath: repos.data?.rootPath ?? null,
        agentRepos: agentRepoMap,
        assignments: assignmentMap,
        agentLinks: agentLinkMap,
      }),
    [tasks, runs.data, todos.data, metaMap, workspaces.data, repos.data, agentRepoMap, assignmentMap, agentLinkMap],
  );

  const errors = [
    live.error,
    settings.status === "error" || settings.status === "invalid" ? settings.error : null,
    repos.error ? errorText(repos.error) : null,
    runs.error ? errorText(runs.error) : null,
    ...(runs.data?.errors ?? []),
    todos.error ? errorText(todos.error) : null,
  ].filter((value): value is string => Boolean(value));

  return {
    tasks,
    work: workItems,
    todos: todos.data?.todos ?? [],
    rootPath: repos.data?.rootPath ?? null,
    deliverEnabled: settings.status === "ready" ? settings.values.deliverEnabled : false,
    intakeProfile: settings.status === "ready" ? settings.values.intakeProfile : "",
    agents: live.agents,
    repos: repos.data?.repos ?? [],
    rootName: repos.data?.rootName ?? "",
    showWorkers: settings.status === "ready" ? settings.values.showWorkers : true,
    actions: settings.status === "ready" ? settings.values.actions : [],
    profiles: new Set((repos.data?.profiles ?? []).map((profile) => profile.id)),
    profileList: repos.data?.profiles ?? [],
    loading: !live.loaded || repos.isPending,
    errors,
    refresh: () => {
      void workspaces.refetch();
      void repos.refetch();
      void runs.refetch();
      void todos.refetch();
      void meta.refetch();
    },
  };
}

export function useLatestReport(agentId: string, updatedAt: string) {
  const paseo = usePaseo();
  return useQuery({
    queryKey: ["report", agentId, updatedAt],
    queryFn: async () => {
      const page = await paseo.agents.ref(agentId).timeline.refetch({ direction: "tail", limit: 40, projection: "projected" });
      for (let index = page.entries.length - 1; index >= 0; index -= 1) {
        const entry = page.entries[index];
        if (entry.item.type === "assistant_message" && entry.item.text.trim()) {
          return { text: entry.item.text.trim(), timestamp: entry.timestamp };
        }
      }
      return null;
    },
    staleTime: 30_000,
  });
}

export function useDismissed() {
  const list = useRpc(listDismissedRpc);
  const dismissed = useQuery({ queryKey: ["dismissed"], queryFn: () => list({}), staleTime: 60_000 });
  return useMemo(() => new Map((dismissed.data?.dismissed ?? []).map((entry) => [entry.key, entry.at])), [dismissed.data]);
}

export function useNotes() {
  const list = useRpc(listNotesRpc);
  const notes = useQuery({ queryKey: ["notes"], queryFn: () => list({}), staleTime: 60_000 });
  return useMemo(() => new Map((notes.data?.notes ?? []).map((note) => [note.key, note.text])), [notes.data]);
}

export function useCleanupJobs() {
  const list = useRpc(cleanupJobsRpc);
  const jobs = useQuery({
    queryKey: ["cleanup-jobs"],
    queryFn: () => list({}),
    refetchInterval: (query) =>
      query.state.data?.jobs.some((job) => job.state === "cleaning" || job.state === "archiving") ? 3_000 : 30_000,
  });
  return jobs.data?.jobs ?? [];
}
