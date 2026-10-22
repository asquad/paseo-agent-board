import { itemKey, type Assignment, type Filter, type Item, type Repo, type RunChild, type RunState, type Todo, type WorkStatus } from "./contracts";
import {
  findRepo,
  INTAKE_LABEL,
  latestActivity,
  normalizePath,
  parseDeliverTitle,
  type BoardWorkspace,
  type Task,
} from "./model";

export interface WorkItem {
  key: string;
  kind: "pr" | "issue" | "scratch" | "workspace";
  loose: boolean;
  repo: string | null;
  number: number | null;
  pr: number | null;
  repos: string[];
  title: string;
  url: string | null;
  labels: string[];
  labelColors: Record<string, string>;
  baseRef: string | null;
  linkedPr: Item["linkedPrs"][number] | null;
  author: string | null;
  status: WorkStatus;
  statusText: string;
  sentAt: string;
  updatedAt: string;
  pinned: boolean;
  run: RunState | null;
  todo: Todo | null;
  meta: Item | null;
  tasks: Task[];
  workspaces: BoardWorkspace[];
  children: RunChild[];
  manualRepos: string[] | null;
  manualLink: string | null;
  childItems: Item[];
  parentKey: string | null;
  childKeys: string[];
  relatedNumbers: { repo: string; number: number }[];
  phase: IntakePhase | null;
  pending: Item[];
}

export type IntakePhase = "analysis" | "approve" | "delivery" | "done";

export const PHASES: { id: IntakePhase; label: string }[] = [
  { id: "analysis", label: "Разбор" },
  { id: "approve", label: "Подтверждение" },
  { id: "delivery", label: "Delivery" },
  { id: "done", label: "Готово" },
];

export const STATUS_LABELS: Record<WorkStatus, string> = {
  attention: "Нужно вмешательство",
  question: "Вопрос к вам",
  running: "В работе",
  finished: "Агент закончил",
  waiting: "Ждёт внешнего",
  ready: "Готово",
  idle: "Остановлено",
  todo: "TODO",
  closed: "Закрыто",
};

const STATUS_ORDER: Record<WorkStatus, number> = {
  attention: 0,
  question: 1,
  running: 2,
  finished: 3,
  waiting: 4,
  ready: 5,
  idle: 6,
  todo: 7,
  closed: 8,
};

export function statusRank(status: WorkStatus): number {
  return STATUS_ORDER[status];
}

interface Draft {
  key: string;
  loose: boolean;
  run: RunState | null;
  todo: Todo | null;
  tasks: Task[];
  workspaces: Set<string>;
  repo: string | null;
  number: number | null;
  kind: WorkItem["kind"];
}

const GITHUB_URL = /github\.com\/([^/\s]+\/[^/\s]+)\/(?:pull|issues)\/(\d+)/i;
const LOOSE_NUMBER = /(?:#|\bpr[-\s]?)(\d{3,})\b/i;
const MIN_SCORE = 3;
const SHARE_OF_TOP = 0.25;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter(Boolean);
}

function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function reposInText(text: string, repos: readonly Repo[]): string[] {
  const tokens = words(text);
  const squashed = new Set<string>();
  for (let index = 0; index < tokens.length; index += 1) {
    squashed.add(squash(tokens[index]));
    if (index + 1 < tokens.length) squashed.add(squash(tokens[index] + tokens[index + 1]));
  }
  const tails = new Map<string, Repo[]>();
  for (const repo of repos) {
    for (const name of [repo.name, repo.github?.split("/")[1] ?? ""]) {
      const tail = name.toLowerCase().split("-").pop();
      if (tail && tail.length >= 5) tails.set(tail, [...(tails.get(tail) ?? []), repo]);
    }
  }
  const found = new Set<string>();
  for (const repo of repos) {
    const id = repo.github ?? repo.name;
    const names = [repo.name, repo.github?.split("/")[1] ?? ""].map(squash).filter((name) => name.length >= 4);
    if (names.some((name) => squashed.has(name))) found.add(id);
  }
  for (const [tail, owners] of tails) {
    const unique = new Set(owners.map((repo) => repo.github ?? repo.name));
    if (unique.size === 1 && tokens.includes(tail)) found.add([...unique][0]);
  }
  return [...found];
}

function repoByName(repos: readonly Repo[], name: string): Repo | undefined {
  const target = squash(name);
  return repos.find((repo) => squash(repo.name) === target || (repo.github && squash(repo.github.split("/")[1]) === target));
}

function workspaceKey(workspace: BoardWorkspace, repos: readonly Repo[]): { repo: string; number: number } | null {
  const title = workspace.title ?? workspace.name;
  const deliver = parseDeliverTitle(title);
  if (deliver) {
    const repo = repoByName(repos, deliver.repoName);
    if (repo?.github) return { repo: repo.github, number: deliver.number };
  }
  const url = GITHUB_URL.exec(title);
  if (url) return { repo: url[1], number: Number(url[2]) };
  const loose = LOOSE_NUMBER.exec(title);
  if (!loose) return null;
  const owner = findRepo(repos, workspace.directory);
  const named = reposInText(title, repos);
  const github = owner?.kind === "git" && owner.github ? owner.github : named.length === 1 ? named[0] : null;
  return github && github.includes("/") ? { repo: github, number: Number(loose[1]) } : null;
}

function agentStatus(
  draft: Draft,
  meta: Item | null,
  workspaces: readonly BoardWorkspace[],
  asks: ReadonlySet<string>,
): { status: WorkStatus; statusText: string } {
  const agents = draft.tasks.flatMap((task) => [task.agent, ...task.workers]);
  const top = draft.tasks.map((task) => task.agent);
  if (agents.some((agent) => agent.pendingPermissions > 0 || agent.attentionReason === "permission")) {
    return { status: "attention", statusText: "Ждёт разрешения" };
  }
  const failed = top.find((agent) => agent.status === "error" || agent.attentionReason === "error");
  if (failed) return { status: "attention", statusText: failed.lastError ? "Ошибка" : "Остановлено с ошибкой" };
  const run = draft.run;
  if (run?.needsUser && run.state !== "final") return { status: "question", statusText: run.needsUser };
  if (agents.some((agent) => agent.status === "running" || agent.status === "initializing")) {
    return { status: "running", statusText: run?.stage ?? "В работе" };
  }
  if (meta && meta.state !== "open") return { status: "closed", statusText: meta.state === "merged" ? "Смёржено" : "Закрыто" };
  if (run?.state === "final") {
    if (/^ready/i.test(run.result ?? "")) return { status: "ready", statusText: run.result ?? "Готово" };
    if (/blocked/i.test(run.result ?? "")) return { status: "waiting", statusText: run.result ?? "Ждёт внешнего" };
    if (run.kind === "scratch") return { status: "ready", statusText: run.result ?? "Задачи запущены" };
    return { status: "attention", statusText: run.result ?? "Не завершено" };
  }
  if (run?.state === "blocked") return { status: "waiting", statusText: run.blocker ?? "Ждёт внешнего" };
  if (workspaces.some((workspace) => workspace.status === "needs_input")) return { status: "question", statusText: "Ждёт ввода" };
  if (workspaces.some((workspace) => workspace.status === "failed")) return { status: "attention", statusText: "Ошибка" };
  if (draft.tasks.length) {
    if (draft.tasks.some((task) => asks.has(task.agent.id))) return { status: "question", statusText: "Агент спрашивает" };
    return { status: "finished", statusText: run?.stage ? `Агент закончил: ${run.stage}` : "Агент закончил" };
  }
  if (draft.todo && !workspaces.length) return { status: "todo", statusText: "TODO" };
  if (workspaces.length) return { status: "idle", statusText: "Агенты архивированы" };
  return { status: "idle", statusText: "Нет агентов" };
}

export interface BuildWorkInput {
  tasks: readonly Task[];
  runs: readonly RunState[];
  todos: readonly Todo[];
  meta: ReadonlyMap<string, Item>;
  workspaces: ReadonlyMap<string, BoardWorkspace>;
  repos: readonly Repo[];
  rootPath: string | null;
  agentRepos: ReadonlyMap<string, readonly { repo: string; score: number }[]>;
  assignments: ReadonlyMap<string, Assignment>;
  agentLinks: ReadonlyMap<string, readonly string[]>;
  agentAsks?: ReadonlySet<string>;
}

export function parseLink(link: string | null | undefined): { repo: string; number: number } | null {
  const match = link ? /^([^#\s]+\/[^#\s]+)#(\d+)$/.exec(link.trim()) : null;
  return match ? { repo: match[1], number: Number(match[2]) } : null;
}

export function buildWork({ tasks, runs, todos, meta, workspaces, repos, rootPath, agentRepos, assignments, agentLinks, agentAsks = new Set() }: BuildWorkInput): WorkItem[] {
  const linkOf = (workspaceId: string | null) => (workspaceId ? parseLink(assignments.get(workspaceId)?.link) : null);
  const root = rootPath ? normalizePath(rootPath) : null;
  const drafts: Draft[] = [];
  const byKey = new Map<string, Draft>();
  const byAgent = new Map<string, Draft>();
  const byWorkspace = new Map<string, Draft>();

  const create = (draft: Omit<Draft, "workspaces" | "tasks" | "run" | "todo"> & Partial<Draft>): Draft => {
    const full: Draft = { run: null, todo: null, tasks: [], workspaces: new Set(), ...draft };
    drafts.push(full);
    return full;
  };
  const keyed = (repo: string, number: number, kind: WorkItem["kind"]): Draft => {
    const key = itemKey(repo, number);
    const existing = byKey.get(key);
    if (existing) return existing;
    const draft = create({ key, loose: false, repo, number, kind });
    byKey.set(key, draft);
    return draft;
  };
  const claimWorkspace = (draft: Draft, workspaceId: string | null) => {
    if (!workspaceId || byWorkspace.has(workspaceId)) return;
    draft.workspaces.add(workspaceId);
    byWorkspace.set(workspaceId, draft);
  };

  for (const run of [...runs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    if (run.kind === "scratch") {
      const draft = create({ key: `scratch:${run.runId}`, loose: false, repo: null, number: null, kind: "scratch", run });
      if (run.coordinatorAgentId) byAgent.set(run.coordinatorAgentId, draft);
      continue;
    }
    if (!run.repo || run.number === null) continue;
    const existing = byKey.get(itemKey(run.repo, run.number)) ?? (run.pr !== null ? byKey.get(itemKey(run.repo, run.pr)) : undefined);
    const draft = existing ?? keyed(run.repo, run.number, run.kind === "pr" ? "pr" : "issue");
    if (!draft.run) draft.run = run;
    if (run.pr !== null && !byKey.has(itemKey(run.repo, run.pr))) byKey.set(itemKey(run.repo, run.pr), draft);
    if (run.coordinatorAgentId) byAgent.set(run.coordinatorAgentId, draft);
  }

  for (const todo of todos) keyed(todo.repo, todo.number, todo.kind).todo = todo;

  const looseTasks = new Map<string, Task[]>();
  for (const task of tasks) {
    const workspaceIds = [task.agent.workspaceId, ...task.workers.map((worker) => worker.workspaceId)];
    let draft = byAgent.get(task.agent.id) ?? null;
    const manual = linkOf(task.agent.workspaceId);
    if (!draft && manual) draft = keyed(manual.repo, manual.number, "issue");
    if (!draft && task.agent.labels[INTAKE_LABEL]) {
      draft = create({ key: `scratch-agent:${task.agent.id}`, loose: false, repo: null, number: null, kind: "scratch" });
    }
    if (!draft && task.repo?.github && task.number !== null) draft = keyed(task.repo.github, task.number, "issue");
    if (!draft && task.workspace) {
      const fromWorkspace = workspaceKey(task.workspace, repos);
      if (fromWorkspace) draft = keyed(fromWorkspace.repo, fromWorkspace.number, "issue");
    }
    if (!draft) {
      const slot = task.agent.workspaceId ?? `agent:${task.agent.id}`;
      looseTasks.set(slot, [...(looseTasks.get(slot) ?? []), task]);
      continue;
    }
    draft.tasks.push(task);
    for (const id of workspaceIds) claimWorkspace(draft, id);
  }

  for (const [slot, slotTasks] of [...looseTasks]) {
    if (!workspaces.has(slot)) continue;
    const manual = linkOf(slot);
    const draft = manual
      ? keyed(manual.repo, manual.number, "issue")
      : create({ key: `ws:${slot}`, loose: true, repo: null, number: null, kind: "workspace" });
    draft.tasks.push(...slotTasks);
    claimWorkspace(draft, slot);
    for (const task of slotTasks) for (const worker of task.workers) claimWorkspace(draft, worker.workspaceId);
    looseTasks.delete(slot);
  }

  for (const workspace of workspaces.values()) {
    if (byWorkspace.has(workspace.id)) continue;
    const directory = normalizePath(workspace.directory);
    if (root && directory !== root && !directory.startsWith(`${root}/`)) continue;
    const key = linkOf(workspace.id) ?? workspaceKey(workspace, repos);
    const draft = key
      ? keyed(key.repo, key.number, "issue")
      : create({ key: `ws:${workspace.id}`, loose: true, repo: null, number: null, kind: "workspace" });
    claimWorkspace(draft, workspace.id);
    const tasksHere = looseTasks.get(workspace.id) ?? [];
    looseTasks.delete(workspace.id);
    draft.tasks.push(...tasksHere);
  }
  for (const [slot, slotTasks] of looseTasks) {
    create({ key: slot.startsWith("agent:") ? slot : `ws:${slot}`, loose: true, repo: null, number: null, kind: "workspace", tasks: slotTasks });
  }

  return group(drafts.map((draft) => finish(draft, meta, workspaces, repos, agentRepos, assignments, agentLinks, agentAsks)));
}

function group(items: WorkItem[]): WorkItem[] {
  const byNumber = new Map<string, WorkItem>();
  for (const item of items) {
    if (item.kind === "scratch" || !item.repo) continue;
    if (item.number !== null) byNumber.set(itemKey(item.repo, item.number), item);
    if (item.pr !== null) byNumber.set(itemKey(item.repo, item.pr), item);
  }
  for (const parent of items) {
    if (parent.kind !== "scratch") continue;
    for (const child of parent.childItems) {
      const item = byNumber.get(itemKey(child.repo, child.number));
      if (!item || item.parentKey || parent.childKeys.includes(item.key)) continue;
      item.parentKey = parent.key;
      parent.childKeys.push(item.key);
    }
  }
  for (const parent of items) {
    if (parent.kind !== "scratch") continue;
    const running = parent.tasks.some((task) => task.agent.status === "running" || task.agent.status === "initializing");
    parent.pending = parent.childItems.filter((child) => {
      const work = byNumber.get(itemKey(child.repo, child.number));
      return child.state === "open" && !(work && work.tasks.length);
    });
    const delivering = parent.childKeys.length > 0;
    const allClosed = parent.childItems.length > 0 && parent.childItems.every((child) => child.state !== "open");
    parent.phase = parent.pending.length ? "approve" : delivering ? (allClosed ? "done" : "delivery") : parent.childItems.length ? (allClosed ? "done" : "approve") : "analysis";
    if (parent.phase === "done" && !running && !parent.tasks.length) {
      parent.status = "closed";
      parent.statusText = "Готово: все issues закрыты";
    }
    if (parent.phase === "approve" && !running && statusRank(parent.status) > statusRank("question")) {
      parent.status = "question";
      parent.statusText = `Ждёт подтверждения: ${parent.pending.length || parent.childItems.length}`;
    }
    if (parent.phase === "analysis" && running) parent.statusText = "Разбирает задачу";
  }
  const byAgent = new Map<string, WorkItem>();
  for (const item of items) {
    for (const task of item.tasks) {
      if (!byAgent.has(task.agent.id)) byAgent.set(task.agent.id, item);
      for (const worker of task.workers) if (!byAgent.has(worker.id)) byAgent.set(worker.id, item);
    }
  }
  for (const item of items) {
    if (item.parentKey) continue;
    const parentAgent = item.tasks.find((task) => task.parentAgentId)?.parentAgentId;
    const parent = parentAgent ? byAgent.get(parentAgent) : undefined;
    if (!parent || parent === item || parent.parentKey === item.key) continue;
    item.parentKey = parent.key;
    parent.childKeys.push(item.key);
  }
  const byKey = new Map(items.map((item) => [item.key, item]));
  for (const parent of items) {
    if (!parent.childKeys.length) continue;
    const children = parent.childKeys
      .map((key) => byKey.get(key))
      .filter((item): item is WorkItem => Boolean(item))
      .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
    parent.childKeys = children.map((child) => child.key);
    parent.relatedNumbers = children.flatMap((child) => (child.repo && child.number !== null ? [{ repo: child.repo, number: child.number }] : []));
    for (const child of children) {
      for (const repo of child.repos) if (!parent.repos.some((known) => known.toLowerCase() === repo.toLowerCase())) parent.repos.push(repo);
    }
    const urgent = [parent, ...children].sort((a, b) => statusRank(a.status) - statusRank(b.status))[0];
    if (urgent !== parent && statusRank(urgent.status) < statusRank(parent.status)) {
      const same = children.filter((child) => child.status === urgent.status && child.number !== null);
      const numbers = same.map((child) => `#${child.number}`).join(", ");
      parent.status = urgent.status;
      parent.statusText = `${numbers ? `${numbers}: ` : ""}${urgent.statusText}`;
    }
    for (const child of children) if (child.updatedAt > parent.updatedAt) parent.updatedAt = child.updatedAt;
  }
  return items;
}

function inferRepos(
  draft: Draft,
  boardWorkspaces: readonly BoardWorkspace[],
  repos: readonly Repo[],
  agentRepos: BuildWorkInput["agentRepos"],
  agentLinks: BuildWorkInput["agentLinks"],
): string[] {
  if (draft.repo) {
    return [draft.repo, ...(draft.run?.children ?? []).map((child) => child.repo)].filter((value, index, list) => list.indexOf(value) === index);
  }
  if (draft.run?.children.length) return [...new Set(draft.run.children.map((child) => child.repo))];
  if (draft.kind === "scratch") {
    const linked = draft.tasks.flatMap((task) => agentLinks.get(task.agent.id) ?? []).map((link) => link.split("#")[0]);
    if (linked.length) return [...new Set(linked)];
  }
  const scores = new Map<string, number>();
  const add = (repo: string, score: number) => scores.set(repo, (scores.get(repo) ?? 0) + score);
  for (const task of draft.tasks) {
    for (const agent of [task.agent, ...task.workers]) {
      for (const { repo, score } of agentRepos.get(agent.id) ?? []) add(repo, score);
      const owner = findRepo(repos, agent.cwd);
      if (owner?.kind === "git") add(owner.github ?? owner.name, MIN_SCORE * 2);
    }
  }
  for (const workspace of boardWorkspaces) {
    const owner = findRepo(repos, workspace.directory);
    if (owner?.kind === "git") add(owner.github ?? owner.name, MIN_SCORE * 3);
    for (const repo of reposInText(workspace.title ?? workspace.name, repos)) add(repo, MIN_SCORE * 3);
  }
  for (const task of draft.tasks) for (const repo of reposInText(task.agent.title ?? "", repos)) add(repo, MIN_SCORE * 3);
  const top = Math.max(0, ...scores.values());
  return [...scores]
    .filter(([, score]) => score >= MIN_SCORE && score >= top * SHARE_OF_TOP)
    .sort((a, b) => b[1] - a[1])
    .map(([repo]) => repo);
}

function finish(
  draft: Draft,
  meta: ReadonlyMap<string, Item>,
  allWorkspaces: ReadonlyMap<string, BoardWorkspace>,
  repos: readonly Repo[],
  agentRepos: BuildWorkInput["agentRepos"],
  assignments: BuildWorkInput["assignments"],
  agentLinks: BuildWorkInput["agentLinks"],
  agentAsks: ReadonlySet<string>,
): WorkItem {
  const childKeys =
    draft.kind !== "scratch"
      ? []
      : draft.run?.children.length
        ? draft.run.children.map((child) => itemKey(child.repo, child.number))
        : (agentLinks.get(draft.tasks[0]?.agent.id ?? "") ?? []).map((link) => link.toLowerCase());
  const childItems = childKeys.map((key) => meta.get(key)).filter((item): item is Item => Boolean(item));
  const details = draft.number !== null && draft.repo ? (meta.get(itemKey(draft.repo, draft.number)) ?? null) : null;
  const prMeta = draft.run?.pr != null && draft.repo ? (meta.get(itemKey(draft.repo, draft.run.pr)) ?? null) : null;
  const statusMeta = draft.run?.kind === "issue" && prMeta ? prMeta : details;
  const linkedCandidates = (details?.linkedPrs ?? []).filter((pr) => !draft.repo || pr.repo.toLowerCase() === draft.repo.toLowerCase());
  const linked =
    linkedCandidates.find((pr) => pr.state === "open") ?? linkedCandidates.find((pr) => pr.state === "merged") ?? linkedCandidates[0] ?? null;
  const workspaces = [...draft.workspaces]
    .map((id) => allWorkspaces.get(id))
    .filter((workspace): workspace is BoardWorkspace => Boolean(workspace));
  const coordinator = draft.tasks[0] ?? null;
  const manual = [...draft.workspaces].map((id) => assignments.get(id)).filter((value): value is Assignment => Boolean(value));
  const manualRepos = manual.some((assignment) => assignment.repos)
    ? [...new Set(manual.flatMap((assignment) => assignment.repos ?? []))]
    : null;
  const manualLink = manual.find((assignment) => assignment.link)?.link ?? null;
  const inferred = inferRepos(draft, workspaces, repos, agentRepos, agentLinks);
  const itemRepos = manualRepos
    ? draft.repo
      ? [...new Set([draft.repo, ...manualRepos])]
      : manualRepos
    : inferred;
  const activity = [
    ...draft.tasks.map(latestActivity),
    ...workspaces.map((workspace) => workspace.activityAt ?? workspace.statusEnteredAt),
    draft.run?.updatedAt,
    details?.updatedAt,
    prMeta?.updatedAt,
    draft.todo?.addedAt,
  ].filter((value): value is string => Boolean(value));
  const sent = [
    draft.run?.startedAt,
    draft.todo?.addedAt,
    ...draft.tasks.map((task) => task.agent.createdAt),
  ].filter((value): value is string => Boolean(value));
  const rawTitle =
    draft.run?.workspaceTitle ??
    coordinator?.workspace?.title ??
    workspaces[0]?.title ??
    workspaces[0]?.name ??
    details?.title ??
    draft.todo?.title ??
    draft.run?.title ??
    coordinator?.agent.title ??
    draft.key;
  const title = draft.kind === "scratch" && ["Scratch", "Intake"].includes(rawTitle.trim()) && childItems[0] ? `Scratch (${childItems[0].title})` : rawTitle;
  return {
    key: draft.key,
    kind: draft.kind === "workspace" || draft.kind === "scratch" ? draft.kind : (details?.kind ?? draft.kind),
    loose: draft.loose,
    repo: draft.repo,
    number: draft.number,
    pr: draft.run?.pr ?? (details?.kind === "pr" ? details.number : (linked?.number ?? null)),
    repos: itemRepos,
    title,
    url: details?.url ?? draft.todo?.url ?? null,
    labels: details?.labels ?? [],
    labelColors: details?.labelColors ?? {},
    baseRef: prMeta?.baseRef ?? details?.baseRef ?? linked?.baseRef ?? null,
    linkedPr: linked,
    author: details?.author ?? null,
    sentAt: sent.sort()[0] ?? [...activity].sort()[0] ?? "",
    updatedAt: [...activity].sort().at(-1) ?? "",
    pinned: workspaces.some((workspace) => Boolean(workspace.pinnedAt)),
    run: draft.run,
    todo: draft.todo,
    meta: details,
    tasks: draft.tasks,
    workspaces,
    children: draft.run?.children ?? [],
    manualRepos,
    manualLink,
    childItems,
    parentKey: null,
    childKeys: [],
    relatedNumbers: [],
    phase: draft.kind === "scratch" ? "analysis" : null,
    pending: [],
    ...agentStatus(draft, statusMeta, workspaces, agentAsks),
  };
}

function matchesText(haystack: string, text: string): boolean {
  const lower = haystack.toLowerCase();
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => lower.includes(word));
}

export function filterWork(items: readonly WorkItem[], filter: Filter, notes: ReadonlyMap<string, string> = new Map()): WorkItem[] {
  const repos = new Set(filter.repos.map((repo) => repo.toLowerCase()));
  return items.filter((item) => {
    if (repos.size && !item.repos.some((repo) => repos.has(repo.toLowerCase()))) return false;
    if (filter.kinds.length && !filter.kinds.includes(item.kind)) return false;
    if (filter.statuses.length && !filter.statuses.includes(item.status)) return false;
    if (filter.labels.length && !filter.labels.every((label) => item.labels.includes(label))) return false;
    if (filter.authors.length && !(item.author && filter.authors.includes(item.author))) return false;
    const bases = filter.bases ?? [];
    if (bases.length && !(item.baseRef && bases.includes(item.baseRef))) return false;
    if (filter.text && !matchesText(`${item.title} ${item.repos.join(" ")} #${item.number ?? ""} ${item.statusText} ${notes.get(item.key) ?? ""}`, filter.text)) {
      return false;
    }
    return true;
  });
}

export type SortColumn = "status" | "title" | "sent" | "updated" | "number";

export function workNumbers(item: WorkItem): { repo: string; number: number }[] {
  const own = item.repo && item.number !== null ? [{ repo: item.repo, number: item.number }] : [];
  const link = !own.length ? parseLink(item.manualLink) : null;
  const all = [
    ...own,
    ...(link ? [link] : []),
    ...item.childItems.map((child) => ({ repo: child.repo, number: child.number })),
    ...item.relatedNumbers,
  ];
  const seen = new Set<string>();
  const unique = all.filter((entry) => {
    const key = itemKey(entry.repo, entry.number);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const [first, ...rest] = unique;
  if (!first) return [];
  const sortedRest = rest.sort((a, b) => a.number - b.number || a.repo.localeCompare(b.repo));
  return own.length ? [first, ...sortedRest] : [first, ...sortedRest].sort((a, b) => a.number - b.number || a.repo.localeCompare(b.repo));
}

export function workNumber(item: WorkItem): { repo: string; number: number } | null {
  return workNumbers(item)[0] ?? null;
}

export function formatWorkNumbers(item: WorkItem, limit = 3): string {
  const numbers = workNumbers(item);
  if (!numbers.length) return "—";
  if (numbers.length === 1 && item.kind === "issue" && item.pr !== null && item.pr !== numbers[0].number) {
    return `#${numbers[0].number} → #${item.pr}`;
  }
  const repos = new Set(numbers.map((entry) => entry.repo.toLowerCase()));
  const label = (entry: { repo: string; number: number }) =>
    repos.size > 1 ? `${entry.repo.split("/").pop()} #${entry.number}` : `#${entry.number}`;
  const shown = numbers.slice(0, limit).map(label).join(", ");
  return numbers.length > limit ? `${shown} +${numbers.length - limit}` : shown;
}

export function compareNumbers(
  a: { repo: string; number: number } | null,
  b: { repo: string; number: number } | null,
): number {
  if (!a || !b) return 0;
  return a.number - b.number || a.repo.localeCompare(b.repo);
}

export function sortWork(items: readonly WorkItem[], column: SortColumn, descending: boolean): WorkItem[] {
  if (column === "number") {
    const numbered = items.filter((item) => workNumber(item));
    const rest = items.filter((item) => !workNumber(item));
    const sorted = numbered.sort((a, b) => compareNumbers(workNumber(a), workNumber(b)));
    return [...(descending ? sorted.reverse() : sorted), ...rest.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))];
  }
  const compare = (a: WorkItem, b: WorkItem): number => {
    switch (column) {
      case "status":
        return statusRank(a.status) - statusRank(b.status) || b.updatedAt.localeCompare(a.updatedAt);
      case "title":
        return a.title.localeCompare(b.title, "ru", { sensitivity: "base", numeric: true });
      case "sent":
        return a.sentAt.localeCompare(b.sentAt);
      default:
        return a.updatedAt.localeCompare(b.updatedAt);
    }
  };
  const sorted = [...items].sort(compare);
  return descending ? sorted.reverse() : sorted;
}

export function workMetaKeys(
  tasks: readonly Task[],
  runs: readonly RunState[],
  todos: readonly Todo[],
  workspaces: ReadonlyMap<string, BoardWorkspace>,
  repos: readonly Repo[],
  links: readonly string[] = [],
): string[] {
  const keys = new Set<string>(links.filter((link) => parseLink(link)));
  for (const run of runs) {
    for (const child of run.children) keys.add(`${child.repo}#${child.number}`);
    if (!run.repo || run.kind === "scratch") continue;
    if (run.number !== null) keys.add(`${run.repo}#${run.number}`);
    if (run.pr !== null) keys.add(`${run.repo}#${run.pr}`);
  }
  for (const todo of todos) keys.add(`${todo.repo}#${todo.number}`);
  for (const task of tasks) if (task.repo?.github && task.number !== null) keys.add(`${task.repo.github}#${task.number}`);
  for (const workspace of workspaces.values()) {
    const key = workspaceKey(workspace, repos);
    if (key) keys.add(`${key.repo}#${key.number}`);
  }
  return [...keys].sort();
}
