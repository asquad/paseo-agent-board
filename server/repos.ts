import { execCommand } from "@getpaseo/plugin/server";
import type { PaseoApi } from "@getpaseo/client";
import { basename } from "node:path";
import type { Repo } from "../shared/contracts";
import { normalizePath } from "../shared/model";

const remotes = new Map<string, string | null>();
const archivedRepos = new Map<string, boolean>();

async function isArchived(github: string | null): Promise<boolean> {
  if (!github) return false;
  const cached = archivedRepos.get(github);
  if (cached !== undefined) return cached;
  let archived = false;
  try {
    const { stdout } = await execCommand("gh", ["api", `repos/${github}`, "--jq", ".archived"], { timeout: 15000 });
    archived = stdout.trim() === "true";
  } catch {
    return false;
  }
  archivedRepos.set(github, archived);
  return archived;
}

export function parseGithubRemote(url: string): string | null {
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match ? `${match[1]}/${match[2]}` : null;
}

async function githubRepo(path: string): Promise<string | null> {
  const cached = remotes.get(path);
  if (cached !== undefined) return cached;
  let repo: string | null = null;
  try {
    const { stdout } = await execCommand("git", ["-C", path, "remote", "get-url", "origin"], { timeout: 5000 });
    repo = parseGithubRemote(stdout);
  } catch {
    repo = null;
  }
  remotes.set(path, repo);
  return repo;
}

export async function listRepos(paseo: PaseoApi, rootPath: string, title: string) {
  const { projects } = await paseo.projects.list({});
  const root = rootPath.trim() ? normalizePath(rootPath.trim()) : null;
  const selected = projects.filter((project) => {
    const path = normalizePath(project.projectRootPath);
    if (/\/\.(worktrees|claude\/worktrees)\//.test(path + "/")) return false;
    return !root || path === root || path.startsWith(root + "/");
  });
  const repos: Repo[] = await Promise.all(
    selected.map(async (project) => ({
      projectId: project.projectId,
      name: project.projectCustomName ?? project.projectDisplayName,
      path: project.projectRootPath,
      kind: project.projectKind,
      github: project.projectKind === "git" ? await githubRepo(project.projectRootPath) : null,
      archived: false,
    })),
  );
  await Promise.all(
    repos.map(async (repo) => {
      repo.archived = await isArchived(repo.github);
    }),
  );
  repos.sort((a, b) => a.name.localeCompare(b.name));
  const rootName = title.trim() || (rootPath.trim() ? basename(rootPath.trim().replace(/[\\/]+$/, "")) : "All projects");
  return { rootPath: rootPath.trim() || null, rootName, repos };
}
