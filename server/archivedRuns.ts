import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { ArchivedRunSchema, type ArchivedRun } from "../shared/contracts";

const FILE = join(homedir(), ".paseo-agent-board", "archived-runs.json");

let queue: Promise<unknown> = Promise.resolve();

function serialized<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task);
  queue = result.catch(() => undefined);
  return result;
}

async function load(): Promise<ArchivedRun[]> {
  try {
    const parsed = z.array(ArchivedRunSchema).safeParse(JSON.parse(await readFile(FILE, "utf8")));
    return parsed.success ? parsed.data : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function save(entries: ArchivedRun[]) {
  await mkdir(dirname(FILE), { recursive: true });
  await writeFile(`${FILE}.tmp`, JSON.stringify(entries, null, 2), "utf8");
  await rename(`${FILE}.tmp`, FILE);
}

export function listArchivedRuns() {
  return serialized(async () => ({ runs: await load() }));
}

export function archiveRuns(runs: readonly ArchivedRun[]) {
  return serialized(async () => {
    const wanted = new Set(runs.map((run) => run.runId));
    const entries = [...(await load()).filter((entry) => !wanted.has(entry.runId)), ...runs];
    await save(entries);
    return { runs: entries };
  });
}
