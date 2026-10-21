import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const ActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().default("Play"),
  targets: z.enum(["pr", "issue", "both"]).default("both"),
  profile: z.string().default(""),
  location: z.enum(["root", "repo"]).default("root"),
  prompt: z.string().min(1),
  askForInput: z.boolean().default(false),
  workspaceTitle: z.string().default("{label} {repoName} #{number}"),
});
export type BoardAction = z.infer<typeof ActionSchema>;

export const DELIVER_ACTION_ID = "deliver";

export const DEFAULT_ACTIONS: BoardAction[] = [
  {
    id: DELIVER_ACTION_ID,
    label: "Deliver",
    icon: "Rocket",
    targets: "both",
    profile: "team-coordinator",
    location: "root",
    prompt: "/deliver {url} {input}",
    askForInput: true,
    workspaceTitle: "Deliver {repoName} #{number}",
  },
];

export const DEFAULT_CLEANUP_PROMPT = [
  "This task is being archived. Clean up what this agent and its subagents created for it, then stop:",
  "- archive or close your subagents, except those that run their own deliver or scratch for another issue or PR: leave those running and list them;",
  "- remove the git worktrees and local branches this task created, but keep any with uncommitted or unpushed work and list them instead;",
  "- deregister the Paseo projects and workspaces this task registered (not the ones it was started in);",
  "- delete temporary files and scratch data this task wrote outside the repositories, keeping reports and artifacts meant for the user;",
  "- update the run state file to final if a deliver or scratch run is still in progress.",
  "Do not push, merge, close issues or PRs, or delete anything you did not create. Reply with a short list of what you removed and what you kept.",
].join("\n");

const BoardSettingsSchema = z.object({
  rootPath: z.string().default(""),
  title: z.string().default(""),
  showWorkers: z.boolean().default(true),
  actions: z.array(ActionSchema).default(DEFAULT_ACTIONS),
  deliverEnabled: z.boolean().default(true),
  runStateDir: z.string().default(""),
  intakeProfile: z.string().default("team-coordinator"),
  intakePrompt: z.string().default("/scratch {input}"),
  draftLabel: z.string().default("draft"),
  cleanupPrompt: z.string().default(DEFAULT_CLEANUP_PROMPT),
});
export type BoardSettingsValues = z.infer<typeof BoardSettingsSchema>;

export const boardSettings = defineSettings({
  id: "board",
  scope: "host",
  version: 2,
  schema: BoardSettingsSchema,
  migrate: (values) => {
    const { coordinatorProfile, ...rest } = (values ?? {}) as Record<string, unknown>;
    const profile = typeof coordinatorProfile === "string" && coordinatorProfile ? coordinatorProfile : "team-coordinator";
    return { ...rest, actions: DEFAULT_ACTIONS.map((action) => ({ ...action, profile })) };
  },
});

export const STATUSES = ["attention", "question", "running", "waiting", "ready", "idle", "todo", "closed"] as const;
export type WorkStatus = (typeof STATUSES)[number];

export const FilterSchema = z.object({
  repos: z.array(z.string()).default([]),
  kinds: z.array(z.string()).default([]),
  statuses: z.array(z.string()).default([]),
  labels: z.array(z.string()).default([]),
  authors: z.array(z.string()).default([]),
  bases: z.array(z.string()).default([]),
  prStates: z.array(z.string()).optional(),
  text: z.string().default(""),
});
export type Filter = z.infer<typeof FilterSchema>;

export const viewSettings = defineSettings({
  id: "view",
  scope: "host",
  version: 1,
  schema: z.object({
    work: FilterSchema.default({ repos: [], kinds: [], statuses: [], labels: [], authors: [], bases: [], text: "" }),
    items: FilterSchema.default({ repos: [], kinds: [], statuses: [], labels: [], authors: [], bases: [], text: "" }),
    itemsSort: z.object({ column: z.enum(["updated", "title", "number"]), descending: z.boolean() }).default({
      column: "updated",
      descending: true,
    }),
    sort: z.object({ column: z.enum(["status", "title", "sent", "updated", "number"]), descending: z.boolean() }).default({
      column: "updated",
      descending: true,
    }),
    noTaskOpen: z.boolean().default(false),
  }),
});

export const RepoSchema = z.object({
  projectId: z.string(),
  name: z.string(),
  path: z.string(),
  kind: z.enum(["git", "non_git", "directory"]),
  github: z.string().nullable(),
});
export type Repo = z.infer<typeof RepoSchema>;

export const reposRpc = defineRpc({
  name: "board.repos",
  input: z.object({}),
  output: z.object({
    rootPath: z.string().nullable(),
    rootName: z.string(),
    repos: z.array(RepoSchema),
    profiles: z.array(z.object({ id: z.string(), name: z.string() })),
  }),
});

export const RunChildSchema = z.object({
  repo: z.string(),
  number: z.number().int(),
  url: z.string().nullable(),
  title: z.string().nullable(),
  role: z.string().nullable(),
  state: z.string().nullable(),
  dependsOn: z.array(z.string()),
  deliverAgentId: z.string().nullable(),
});
export type RunChild = z.infer<typeof RunChildSchema>;

export const RunStateSchema = z.object({
  runId: z.string(),
  repo: z.string().nullable(),
  kind: z.enum(["pr", "issue", "scratch"]).nullable(),
  number: z.number().int().nullable(),
  pr: z.number().int().nullable(),
  title: z.string().nullable(),
  workspaceTitle: z.string().nullable(),
  coordinatorAgentId: z.string().nullable(),
  worktree: z.string().nullable(),
  state: z.enum(["in-progress", "blocked", "final"]),
  round: z.number().int().nullable(),
  stage: z.string().nullable(),
  lastCompleted: z.string().nullable(),
  next: z.string().nullable(),
  score: z.number().nullable(),
  scoreTarget: z.number().nullable(),
  result: z.string().nullable(),
  blocker: z.string().nullable(),
  needsUser: z.string().nullable(),
  statusCommentUrl: z.string().nullable(),
  children: z.array(RunChildSchema),
  startedAt: z.string().nullable(),
  updatedAt: z.string(),
  file: z.string(),
});
export type RunState = z.infer<typeof RunStateSchema>;

export const runsRpc = defineRpc({
  name: "deliver.runs",
  input: z.object({}),
  output: z.object({ dir: z.string().nullable(), runs: z.array(RunStateSchema), errors: z.array(z.string()) }),
});

export const PrStatusSchema = z.object({
  url: z.string(),
  title: z.string(),
  state: z.string(),
  isDraft: z.boolean(),
  reviewDecision: z.string().nullable(),
  mergeable: z.string().nullable(),
  headRefName: z.string(),
  checks: z.object({ passed: z.number(), failed: z.number(), pending: z.number(), failedNames: z.array(z.string()) }),
  deliver: z
    .object({
      state: z.string(),
      score: z.number().nullable(),
      commentUrl: z.string(),
      updatedAt: z.string(),
    })
    .nullable(),
});
export type PrStatus = z.infer<typeof PrStatusSchema>;

export const prStatusRpc = defineRpc({
  name: "deliver.pr-status",
  input: z.object({ repo: z.string(), number: z.number().int().positive() }),
  output: PrStatusSchema,
});

export const ItemSchema = z.object({
  repo: z.string(),
  number: z.number().int().positive(),
  kind: z.enum(["pr", "issue"]),
  url: z.string(),
  title: z.string(),
  author: z.string().nullable(),
  updatedAt: z.string().nullable(),
  isDraft: z.boolean(),
  labels: z.array(z.string()).default([]),
  labelColors: z.record(z.string(), z.string()).default({}),
  state: z.enum(["open", "closed", "merged"]).default("open"),
  baseRef: z.string().nullable().default(null),
  linkedPrs: z
    .array(
      z.object({
        repo: z.string(),
        number: z.number().int(),
        url: z.string(),
        state: z.string(),
        isDraft: z.boolean(),
        baseRef: z.string().nullable(),
      }),
    )
    .default([]),
});
export type Item = z.infer<typeof ItemSchema>;

export const searchItemsRpc = defineRpc({
  name: "items.search",
  input: z.object({
    repos: z.array(z.string()),
    query: z.string(),
    kind: z.enum(["pr", "issue", "all"]),
    labels: z.array(z.string()).default([]),
    author: z.string().nullable().default(null),
    bases: z.array(z.string()).default([]),
    prStates: z.array(z.string()).default([]),
  }),
  output: z.object({ items: z.array(ItemSchema), repos: z.array(z.string()) }),
});

export const resolveItemRpc = defineRpc({
  name: "items.resolve",
  input: z.object({ reference: z.string().min(1), defaultRepo: z.string().nullable() }),
  output: ItemSchema,
});

export const lookupItemsRpc = defineRpc({
  name: "items.lookup",
  input: z.object({ keys: z.array(z.string()) }),
  output: z.object({ items: z.array(ItemSchema), errors: z.array(z.string()) }),
});

export const runActionRpc = defineRpc({
  name: "actions.run",
  input: z.object({ actionId: z.string(), item: ItemSchema, input: z.string().default("") }),
  output: z.object({ workspaceId: z.string(), agentId: z.string().nullable(), prompt: z.string() }),
});

export const TodoSchema = z.object({
  repo: z.string(),
  number: z.number().int().positive(),
  kind: z.enum(["pr", "issue"]),
  title: z.string(),
  url: z.string(),
  addedAt: z.string(),
});
export type Todo = z.infer<typeof TodoSchema>;

export const listTodosRpc = defineRpc({
  name: "todo.list",
  input: z.object({}),
  output: z.object({ todos: z.array(TodoSchema) }),
});

export const addTodoRpc = defineRpc({
  name: "todo.add",
  input: ItemSchema,
  output: z.object({ todos: z.array(TodoSchema) }),
});

export const removeTodoRpc = defineRpc({
  name: "todo.remove",
  input: z.object({ repo: z.string(), number: z.number().int().positive() }),
  output: z.object({ todos: z.array(TodoSchema) }),
});

export const agentReposRpc = defineRpc({
  name: "agents.repos",
  input: z.object({ agents: z.array(z.object({ id: z.string(), updatedAt: z.string() })) }),
  output: z.object({
    results: z.array(
      z.object({ id: z.string(), repos: z.array(z.object({ repo: z.string(), score: z.number() })), links: z.array(z.string()) }),
    ),
  }),
});

export const AssignmentSchema = z.object({
  workspaceId: z.string(),
  repos: z.array(z.string()).nullable(),
  link: z.string().nullable(),
});
export type Assignment = z.infer<typeof AssignmentSchema>;

export const listAssignmentsRpc = defineRpc({
  name: "assignments.list",
  input: z.object({}),
  output: z.object({ assignments: z.array(AssignmentSchema) }),
});

export const setAssignmentsRpc = defineRpc({
  name: "assignments.set",
  input: z.object({
    workspaceIds: z.array(z.string()).min(1),
    repos: z.array(z.string()).nullable().optional(),
    link: z.string().nullable().optional(),
  }),
  output: z.object({ assignments: z.array(AssignmentSchema) }),
});

export const CleanupJobSchema = z.object({
  agentId: z.string(),
  state: z.enum(["cleaning", "archiving", "done", "failed", "needs-you"]),
  message: z.string(),
  report: z.string().nullable(),
  startedAt: z.string(),
  updatedAt: z.string(),
});
export type CleanupJob = z.infer<typeof CleanupJobSchema>;

export const startCleanupRpc = defineRpc({
  name: "agents.cleanup-archive",
  input: z.object({ agentId: z.string(), skipCleanup: z.boolean().default(false) }),
  output: z.object({ job: CleanupJobSchema }),
});

export const cleanupJobsRpc = defineRpc({
  name: "agents.cleanup-jobs",
  input: z.object({}),
  output: z.object({ jobs: z.array(CleanupJobSchema) }),
});

export const undraftRpc = defineRpc({
  name: "items.undraft",
  input: z.object({ repo: z.string(), number: z.number().int().positive(), label: z.string().default("draft") }),
  output: z.object({ ok: z.boolean() }),
});

export const approveIntakeRpc = defineRpc({
  name: "scratch.approve",
  input: z.object({ intakeAgentId: z.string().nullable(), items: z.array(ItemSchema).min(1), instructions: z.string().default("") }),
  output: z.object({
    started: z.array(z.object({ key: z.string(), agentId: z.string().nullable(), prompt: z.string() })),
    failed: z.array(z.object({ key: z.string(), error: z.string() })),
  }),
});

export const rejectIntakeItemRpc = defineRpc({
  name: "scratch.reject",
  input: z.object({ intakeAgentId: z.string().nullable(), item: ItemSchema }),
  output: z.object({ ok: z.boolean(), draftLabel: z.string() }),
});

export const requestIntakeChangesRpc = defineRpc({
  name: "scratch.changes",
  input: z.object({ intakeAgentId: z.string(), text: z.string().min(1) }),
  output: z.object({ ok: z.boolean() }),
});

export const NoteSchema = z.object({ key: z.string(), text: z.string(), updatedAt: z.string() });
export type Note = z.infer<typeof NoteSchema>;

export const listNotesRpc = defineRpc({
  name: "notes.list",
  input: z.object({}),
  output: z.object({ notes: z.array(NoteSchema) }),
});

export const setNoteRpc = defineRpc({
  name: "notes.set",
  input: z.object({ key: z.string().min(1), text: z.string().max(20000) }),
  output: z.object({ notes: z.array(NoteSchema) }),
});

export const launchIntakeRpc = defineRpc({
  name: "scratch.launch",
  input: z.object({
    description: z.string().min(1),
    attachments: z
      .array(z.object({ name: z.string(), mimeType: z.string(), data: z.string() }))
      .max(20)
      .default([]),
  }),
  output: z.object({ workspaceId: z.string(), agentId: z.string().nullable(), prompt: z.string() }),
});

export const PR_STATES = [
  { value: "ready", label: "Готов к ревью", query: "draft:false" },
  { value: "review_required", label: "Ждёт ревью", query: "draft:false review:required" },
  { value: "approved", label: "Одобрен", query: "review:approved" },
  { value: "changes_requested", label: "Нужны правки", query: "review:changes_requested" },
  { value: "draft", label: "Черновик", query: "draft:true" },
] as const;
export const DEFAULT_PR_STATES = ["ready"];

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const MAX_ATTACHMENTS_TOTAL_BYTES = 25 * 1024 * 1024;

export function itemKey(repo: string, number: number): string {
  return `${repo.toLowerCase()}#${number}`;
}
