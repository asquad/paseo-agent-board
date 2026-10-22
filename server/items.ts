import { execCommand } from "@getpaseo/plugin/server";
import { execFile } from "node:child_process";
import { itemKey, type Item } from "../shared/contracts";
import { parseReference } from "../shared/actions";

const LOOKUP_TTL_MS = 5 * 60 * 1000;
const LOOKUP_CONCURRENCY = 6;

async function gh(args: string[]): Promise<string> {
  try {
    const { stdout } = await execCommand("gh", args, { timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(stderr || `gh ${args.slice(0, 2).join(" ")} failed`);
  }
}

interface PrReview {
  reviewDecision: string | null;
  isDraft: boolean;
  baseRef: string | null;
}

const REVIEW_TTL_MS = 2 * 60 * 1000;
const REVIEW_BATCH = 40;
const reviewCache = new Map<string, { review: PrReview; at: number }>();

async function prReviews(prs: readonly { repo: string; number: number }[]): Promise<Map<string, PrReview>> {
  const result = new Map<string, PrReview>();
  const now = Date.now();
  const pending = prs.filter((pr) => {
    const cached = reviewCache.get(itemKey(pr.repo, pr.number));
    if (cached && now - cached.at < REVIEW_TTL_MS) {
      result.set(itemKey(pr.repo, pr.number), cached.review);
      return false;
    }
    return /^[\w.-]+\/[\w.-]+$/.test(pr.repo);
  });
  for (let start = 0; start < pending.length; start += REVIEW_BATCH) {
    const batch = pending.slice(start, start + REVIEW_BATCH);
    const fields = batch
      .map((pr, index) => {
        const [owner, name] = pr.repo.split("/");
        return `p${index}: repository(owner: "${owner}", name: "${name}") { pullRequest(number: ${pr.number}) { reviewDecision isDraft baseRefName } }`;
      })
      .join("\n");
    try {
      const output = await ghDirect(["api", "graphql", "-f", `query=query {\n${fields}\n}`]);
      const data = (JSON.parse(output) as {
        data?: Record<string, { pullRequest?: { reviewDecision: string | null; isDraft: boolean; baseRefName: string | null } | null } | null>;
      }).data ?? {};
      batch.forEach((pr, index) => {
        const node = data[`p${index}`]?.pullRequest;
        if (!node) return;
        const review = { reviewDecision: node.reviewDecision ?? null, isDraft: node.isDraft, baseRef: node.baseRefName ?? null };
        reviewCache.set(itemKey(pr.repo, pr.number), { review, at: Date.now() });
        result.set(itemKey(pr.repo, pr.number), review);
      });
    } catch {
      // Review markers are optional; the list works without them.
    }
  }
  return result;
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

interface LinkedPrNode {
  number: number;
  url: string;
  state: string;
  isDraft: boolean;
  baseRefName: string | null;
  reviewDecision: string | null;
  repository: { nameWithOwner: string };
}

const LINKED_PRS_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      closedByPullRequestsReferences(first: 10, includeClosedPrs: true) {
        nodes { number url state isDraft baseRefName reviewDecision repository { nameWithOwner } }
      }
    }
  }
}`;

export function ghDirect(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("gh", args, { timeout: 30000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message).trim()));
      else resolve(stdout);
    });
  });
}

async function linkedPrs(repo: string, number: number): Promise<Item["linkedPrs"]> {
  const [owner, name] = repo.split("/");
  try {
    const output = await ghDirect(["api", "graphql", "-f", `query=${LINKED_PRS_QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `number=${number}`]);
    const nodes = (JSON.parse(output) as {
      data?: { repository?: { issue?: { closedByPullRequestsReferences?: { nodes?: LinkedPrNode[] } } } };
    }).data?.repository?.issue?.closedByPullRequestsReferences?.nodes ?? [];
    return nodes.map((node) => ({
      repo: node.repository.nameWithOwner,
      number: node.number,
      url: node.url,
      state: node.state.toLowerCase(),
      isDraft: node.isDraft,
      baseRef: node.baseRefName,
      reviewDecision: node.reviewDecision ?? null,
    }));
  } catch {
    return [];
  }
}

async function fetchItem(repo: string, number: number): Promise<Item> {
  const issue = JSON.parse(await gh(["api", `repos/${repo}/issues/${number}`])) as IssueResponse;
  const merged = Boolean(issue.pull_request?.merged_at);
  reviewCache.delete(itemKey(repo, number));
  const review = issue.pull_request ? ((await prReviews([{ repo, number }])).get(itemKey(repo, number)) ?? null) : null;
  const baseRef = review?.baseRef ?? null;
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
    reviewDecision: review?.reviewDecision ?? null,
    linkedPrs: issue.pull_request ? [] : await linkedPrs(repo, number),
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
