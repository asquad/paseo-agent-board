import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { DismissedSchema, type Dismissed } from "../shared/contracts";

const FILE = join(homedir(), ".paseo-agent-board", "dismissed.json");

let queue: Promise<unknown> = Promise.resolve();

function serialized<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task);
  queue = result.catch(() => undefined);
  return result;
}

async function load(): Promise<Dismissed[]> {
  try {
    const parsed = z.array(DismissedSchema).safeParse(JSON.parse(await readFile(FILE, "utf8")));
    return parsed.success ? parsed.data : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function save(entries: Dismissed[]) {
  await mkdir(dirname(FILE), { recursive: true });
  await writeFile(`${FILE}.tmp`, JSON.stringify(entries, null, 2), "utf8");
  await rename(`${FILE}.tmp`, FILE);
}

export function listDismissed() {
  return serialized(async () => ({ dismissed: await load() }));
}

export function setDismissed(keys: readonly string[], dismissed: boolean) {
  return serialized(async () => {
    const wanted = new Set(keys);
    const entries = (await load()).filter((entry) => !wanted.has(entry.key));
    if (dismissed) {
      const at = new Date().toISOString();
      for (const key of wanted) entries.push({ key, at });
    }
    await save(entries);
    return { dismissed: entries };
  });
}
