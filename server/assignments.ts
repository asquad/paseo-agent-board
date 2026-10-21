import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { AssignmentSchema, type Assignment } from "../shared/contracts";

const FILE = join(homedir(), ".paseo-agent-board", "assignments.json");

let queue: Promise<unknown> = Promise.resolve();

function serialized<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task);
  queue = result.catch(() => undefined);
  return result;
}

async function load(): Promise<Assignment[]> {
  try {
    const parsed = z.array(AssignmentSchema).safeParse(JSON.parse(await readFile(FILE, "utf8")));
    return parsed.success ? parsed.data : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function save(assignments: Assignment[]) {
  await mkdir(dirname(FILE), { recursive: true });
  await writeFile(`${FILE}.tmp`, JSON.stringify(assignments, null, 2), "utf8");
  await rename(`${FILE}.tmp`, FILE);
}

export function listAssignments() {
  return serialized(async () => ({ assignments: await load() }));
}

export function setAssignments(workspaceIds: readonly string[], patch: { repos?: string[] | null; link?: string | null }) {
  return serialized(async () => {
    const byId = new Map((await load()).map((assignment) => [assignment.workspaceId, assignment]));
    for (const workspaceId of workspaceIds) {
      const current = byId.get(workspaceId) ?? { workspaceId, repos: null, link: null };
      const next: Assignment = {
        workspaceId,
        repos: patch.repos === undefined ? current.repos : patch.repos,
        link: patch.link === undefined ? current.link : patch.link,
      };
      if (next.repos === null && next.link === null) byId.delete(workspaceId);
      else byId.set(workspaceId, next);
    }
    const assignments = [...byId.values()];
    await save(assignments);
    return { assignments };
  });
}
