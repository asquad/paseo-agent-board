import { execCommand } from "@getpaseo/plugin/server";
import { itemKey, type Item } from "../shared/contracts";
import { parseReference } from "../shared/actions";

const MAX_REPOS = 30;
const LOOKUP_TTL_MS = 5 * 60 * 1000;
const LOOKUP_CONCURRENCY = 6;

interface SearchRow {
  number: number;
  title: string;
  url: string;
  updatedAt?: string;
  isDraft?: boolean;
  author?: { login?: string } | null;
  labels?: { name: string; color?: string }[];
  repository: { nameWithOwner: string };
}

async function gh(args: string[]): Promise<string> {
  try {
    const { stdout } = await execCommand("gh", args, { timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(stderr || `gh ${args.slice(0, 2).join(" ")} failed`);
  }
}

interface SearchOptions {
  query: string;
  labels: readonly string[];
  author: string | null;
  base?: string | null;
}

async function search(kind: "pr" | "issue", repos: readonly string[], { query, labels, author, base }: SearchOptions): Promise<Item[]> {
  const fields =
    kind === "pr"
      ? "number,title,url,updatedAt,isDraft,author,labels,repository"
      : "number,title,url,updatedAt,author,labels,repository";
  const args = ["search", kind === "pr" ? "prs" : "issues"];
  if (query.trim()) args.push(query.trim());
  for (const repo of repos) args.push("--repo", repo);
  for (const label of labels) args.push("--label", label);
  if (author) args.push("--author", author);
  if (base && kind === "pr") args.push("--base", base);
  args.push("--state", "open", "--sort", "updated", "--limit", "100", "--json", fields);
  const rows = JSON.parse(await gh(args)) as SearchRow[];
  return rows.map((row) => ({
    repo: row.repository.nameWithOwner,
    number: row.number,
    kind,
    url: row.url,
    title: row.title,
    author: row.author?.login ?? null,
    updatedAt: row.updatedAt ?? null,
    isDraft: row.isDraft ?? false,
    labels: (row.labels ?? []).map((label) => label.name),
    labelColors: Object.fromEntries((row.labels ?? []).flatMap((label) => (label.color ? [[label.name, label.color]] : []))),
    state: "open" as const,
    baseRef: kind === "pr" ? (base ?? null) : null,
  }));
}

export async function searchItems(
  repos: readonly string[],
  kind: "pr" | "issue" | "all",
  options: SearchOptions & { bases?: readonly string[] },
): Promise<Item[]> {
  const scope = repos.slice(0, MAX_REPOS);
  if (!scope.length) return [];
  const bases = options.bases ?? [];
  if (bases.length) {
    if (kind === "issue") return [];
    const results = await Promise.all(bases.map((base) => search("pr", scope, { ...options, base })));
    return results.flat().sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }
  const kinds: ("pr" | "issue")[] = kind === "all" ? ["pr", "issue"] : [kind];
  const results = await Promise.all(kinds.map((current) => search(current, scope, options)));
  return results.flat().sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

interface IssueResponse {
  number: number;
  title: string;
  html_url: string;
  state: "open" | "closed";
  updated_at?: string;
  draft?: boolean;
  user?: { login?: string } | null;
  labels?: ({ name?: string; color?: string } | string)[];
  pull_request?: { merged_at?: string | null } | null;
}

async function fetchItem(repo: string, number: number): Promise<Item> {
  const issue = JSON.parse(await gh(["api", `repos/${repo}/issues/${number}`])) as IssueResponse;
  const merged = Boolean(issue.pull_request?.merged_at);
  let baseRef: string | null = null;
  if (issue.pull_request) {
    try {
      baseRef = (JSON.parse(await gh(["api", `repos/${repo}/pulls/${number}`, "--jq", "{base: .base.ref}"])) as { base?: string }).base ?? null;
    } catch {
      baseRef = null;
    }
  }
  const item: Item = {
    repo,
    number: issue.number,
    kind: issue.pull_request ? "pr" : "issue",
    url: issue.html_url,
    title: issue.title,
    author: issue.user?.login ?? null,
    updatedAt: issue.updated_at ?? null,
    isDraft: issue.draft ?? false,
    labels: (issue.labels ?? []).map((label) => (typeof label === "string" ? label : (label.name ?? ""))).filter(Boolean),
    labelColors: Object.fromEntries(
      (issue.labels ?? []).flatMap((label) => (typeof label !== "string" && label.name && label.color ? [[label.name, label.color]] : [])),
    ),
    state: merged ? "merged" : issue.state,
    baseRef,
  };
  cache.set(itemKey(repo, number), { item, at: Date.now() });
  return item;
}

export async function resolveItem(reference: string, defaultRepo: string | null): Promise<Item> {
  const parsed = parseReference(reference);
  if (!parsed) throw new Error("Enter a GitHub PR or issue URL, owner/repo#123 or a number.");
  const repo = parsed.repo ?? defaultRepo;
  if (!repo) throw new Error("Choose a repository or paste the full URL.");
  return fetchItem(repo, parsed.number);
}

const cache = new Map<string, { item: Item; at: number }>();

export function forgetItem(repo: string, number: number) {
  cache.delete(itemKey(repo, number));
}

export async function lookupItems(keys: readonly string[]) {
  const items: Item[] = [];
  const errors: string[] = [];
  const pending: { repo: string; number: number }[] = [];
  const now = Date.now();
  for (const key of new Set(keys)) {
    const match = /^([^#\s]+\/[^#\s]+)#(\d+)$/.exec(key);
    if (!match) continue;
    const cached = cache.get(itemKey(match[1], Number(match[2])));
    if (cached && now - cached.at < LOOKUP_TTL_MS) items.push(cached.item);
    else pending.push({ repo: match[1], number: Number(match[2]) });
  }
  let next = 0;
  async function worker() {
    while (next < pending.length) {
      const { repo, number } = pending[next++];
      try {
        items.push(await fetchItem(repo, number));
      } catch (error) {
        const stale = cache.get(itemKey(repo, number));
        if (stale) items.push(stale.item);
        errors.push(`${repo}#${number}: ${(error as Error).message.split("\n")[0]}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, pending.length) }, worker));
  return { items, errors };
}

export async function removeLabel(repo: string, number: number, label: string) {
  await gh(["issue", "edit", String(number), "-R", repo, "--remove-label", label]);
  forgetItem(repo, number);
  return { ok: true };
}
