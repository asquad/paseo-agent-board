import type { PaseoApi } from "@getpaseo/client";
import type { Repo } from "../shared/contracts";
import { normalizePath } from "../shared/model";

const TIMELINE_LIMIT = 400;
const CONCURRENCY = 4;
const MAX_LINKS = 10;

interface Scan {
  repos: { repo: string; score: number }[];
  links: string[];
}

const cache = new Map<string, Scan & { updatedAt: string }>();

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function gitBashPath(path: string): string | null {
  const match = /^([a-z]):\/(.*)$/.exec(path);
  return match ? `/${match[1]}/${match[2]}` : null;
}

export function repoMatcher(repos: readonly Repo[], rootPath: string | null) {
  const byDir = new Map<string, string>();
  const byGithub = new Map<string, string>();
  const root = rootPath ? normalizePath(rootPath) : null;
  for (const repo of repos) {
    const id = repo.github ?? repo.name;
    const path = normalizePath(repo.path);
    if (root && path.startsWith(`${root}/`)) byDir.set(path.slice(root.length + 1), id);
    if (repo.github) byGithub.set(repo.github.toLowerCase(), id);
  }
  const prefixes = root ? [root, gitBashPath(root)].filter((value): value is string => Boolean(value)) : [];
  const pathPattern = prefixes.length ? new RegExp(`(?:${prefixes.map(escape).join("|")})/([a-z0-9._-]+)`, "g") : null;
  const githubPattern = /github\.com[/:]([a-z0-9._-]+\/[a-z0-9._-]+?)(?:\.git)?(?=[/"'\s#)?]|$)/g;
  return (text: string): Set<string> => {
    const lower = text.replace(/\\\\/g, "/").replace(/\\/g, "/").toLowerCase();
    const found = new Set<string>();
    if (pathPattern) {
      for (const match of lower.matchAll(pathPattern)) {
        const repo = byDir.get(match[1]);
        if (repo) found.add(repo);
      }
    }
    for (const match of lower.matchAll(githubPattern)) {
      const repo = byGithub.get(match[1]);
      if (repo) found.add(repo);
    }
    return found;
  };
}

const ITEM_URL = /github\.com\/([\w.-]+\/[\w.-]+)\/(?:issues|pull)\/(\d+)/g;

async function scanAgent(paseo: PaseoApi, id: string, match: (text: string) => Set<string>): Promise<Scan> {
  const page = await paseo.agents.ref(id).timeline.refetch({ direction: "tail", limit: TIMELINE_LIMIT, projection: "canonical" });
  const counts = new Map<string, number>();
  const links: string[] = [];
  for (const entry of page.entries) {
    for (const repo of match(JSON.stringify(entry.item))) counts.set(repo, (counts.get(repo) ?? 0) + 1);
    if (entry.item.type !== "assistant_message") continue;
    for (const url of entry.item.text.matchAll(ITEM_URL)) {
      const key = `${url[1]}#${url[2]}`;
      const index = links.indexOf(key);
      if (index !== -1) links.splice(index, 1);
      links.push(key);
    }
  }
  return {
    repos: [...counts].map(([repo, score]) => ({ repo, score })).sort((a, b) => b.score - a.score),
    links: links.reverse().slice(0, MAX_LINKS),
  };
}

export async function agentRepos(
  paseo: PaseoApi,
  agents: readonly { id: string; updatedAt: string }[],
  repos: readonly Repo[],
  rootPath: string | null,
) {
  const match = repoMatcher(repos, rootPath);
  const results: ({ id: string } & Scan)[] = [];
  const pending = agents.filter((agent) => {
    const cached = cache.get(agent.id);
    if (cached && cached.updatedAt === agent.updatedAt) {
      results.push({ id: agent.id, repos: cached.repos, links: cached.links });
      return false;
    }
    return true;
  });
  let next = 0;
  async function worker() {
    while (next < pending.length) {
      const agent = pending[next++];
      try {
        const found = await scanAgent(paseo, agent.id, match);
        cache.set(agent.id, { updatedAt: agent.updatedAt, ...found });
        results.push({ id: agent.id, ...found });
      } catch {
        const cached = cache.get(agent.id);
        results.push({ id: agent.id, repos: cached?.repos ?? [], links: cached?.links ?? [] });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));
  return { results };
}
