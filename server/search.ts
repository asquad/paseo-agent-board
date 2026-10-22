import { itemKey, PR_STATES, type Item } from "../shared/contracts";
import { ghDirect } from "./items";

const PAGE_SIZE = 50;
const MAX_REPOS = 30;

export type Cursors = Record<string, string | null>;

export interface SearchOptions {
  query: string;
  labels: readonly string[];
  author: string | null;
  bases: readonly string[];
  prStates: readonly string[];
}

interface SubQuery {
  key: string;
  query: string;
}

interface SearchNode {
  __typename: "Issue" | "PullRequest" | string;
  number: number;
  title: string;
  url: string;
  updatedAt: string | null;
  isDraft?: boolean;
  reviewDecision?: string | null;
  baseRefName?: string | null;
  author?: { login?: string } | null;
  labels?: { nodes?: { name: string; color?: string }[] } | null;
  repository: { nameWithOwner: string };
}

interface SearchResponse {
  data?: {
    search?: {
      issueCount: number;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: (SearchNode | null)[];
    };
  };
  errors?: { message: string }[];
}

const SEARCH_QUERY = `query($q: String!, $first: Int!, $after: String) {
  search(query: $q, type: ISSUE, first: $first, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      __typename
      ... on Issue {
        number title url updatedAt
        author { login }
        labels(first: 10) { nodes { name color } }
        repository { nameWithOwner }
      }
      ... on PullRequest {
        number title url updatedAt isDraft reviewDecision baseRefName
        author { login }
        labels(first: 10) { nodes { name color } }
        repository { nameWithOwner }
      }
    }
  }
}`;

function qualifier(name: string, value: string): string {
  return /[\s"]/.test(value) ? `${name}:"${value.replace(/"/g, "")}"` : `${name}:${value}`;
}

export function buildQueries(scope: readonly string[], kind: "pr" | "issue" | "all", options: SearchOptions): SubQuery[] {
  const common = [
    "is:open",
    ...scope.slice(0, MAX_REPOS).map((repo) => `repo:${repo}`),
    ...options.labels.map((label) => qualifier("label", label)),
    options.author ? qualifier("author", options.author) : "",
    "sort:updated-desc",
    options.query.trim(),
  ].filter(Boolean);
  const queries: SubQuery[] = [];
  if (kind !== "pr" && !options.bases.length) queries.push({ key: "issue", query: [...common, "is:issue"].join(" ") });
  if (kind !== "issue") {
    const states = options.prStates
      .map((state) => PR_STATES.find((candidate) => candidate.value === state))
      .filter((state): state is (typeof PR_STATES)[number] => Boolean(state));
    for (const base of options.bases.length ? options.bases : [null]) {
      for (const state of states.length ? states : [null]) {
        queries.push({
          key: `pr:${base ?? ""}:${state?.value ?? ""}`,
          query: [...common, "is:pr", base ? qualifier("base", base) : "", state?.query ?? ""].filter(Boolean).join(" "),
        });
      }
    }
  }
  return queries;
}

function toItem(node: SearchNode): Item {
  const labels = node.labels?.nodes ?? [];
  const pr = node.__typename === "PullRequest";
  return {
    repo: node.repository.nameWithOwner,
    number: node.number,
    kind: pr ? "pr" : "issue",
    url: node.url,
    title: node.title,
    author: node.author?.login ?? null,
    updatedAt: node.updatedAt ?? null,
    isDraft: node.isDraft ?? false,
    labels: labels.map((label) => label.name),
    labelColors: Object.fromEntries(labels.flatMap((label) => (label.color ? [[label.name, label.color]] : []))),
    state: "open",
    baseRef: pr ? (node.baseRefName ?? null) : null,
    reviewDecision: pr ? (node.reviewDecision ?? null) : null,
    linkedPrs: [],
  };
}

async function runPage(query: string, after: string | null) {
  const args = ["api", "graphql", "-f", `query=${SEARCH_QUERY}`, "-f", `q=${query}`, "-F", `first=${PAGE_SIZE}`];
  if (after) args.push("-f", `after=${after}`);
  const response = JSON.parse(await ghDirect(args)) as SearchResponse;
  const search = response.data?.search;
  if (!search) throw new Error(response.errors?.[0]?.message ?? "GitHub search failed");
  return {
    items: search.nodes.filter((node): node is SearchNode => Boolean(node && node.repository)).map(toItem),
    cursor: search.pageInfo.hasNextPage ? search.pageInfo.endCursor : null,
    count: search.issueCount,
  };
}

export async function searchPage(
  scope: readonly string[],
  kind: "pr" | "issue" | "all",
  options: SearchOptions,
  cursors: Cursors | null,
): Promise<{ items: Item[]; cursors: Cursors; total: number }> {
  if (!scope.length) return { items: [], cursors: {}, total: 0 };
  const queries = buildQueries(scope, kind, options);
  const active = cursors ? queries.filter((query) => cursors[query.key]) : queries;
  const pages = await Promise.all(active.map(async (query) => ({ key: query.key, ...(await runPage(query.query, cursors?.[query.key] ?? null)) })));
  const next: Cursors = {};
  for (const query of queries) next[query.key] = null;
  for (const page of pages) next[page.key] = page.cursor;
  const seen = new Set<string>();
  const items = pages
    .flatMap((page) => page.items)
    .filter((item) => {
      const key = itemKey(item.repo, item.number);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return { items, cursors: next, total: pages.reduce((sum, page) => sum + page.count, 0) };
}
