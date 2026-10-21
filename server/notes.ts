import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { NoteSchema, type Note } from "../shared/contracts";

const FILE = join(homedir(), ".paseo-agent-board", "notes.json");

let queue: Promise<unknown> = Promise.resolve();

function serialized<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task);
  queue = result.catch(() => undefined);
  return result;
}

async function load(): Promise<Note[]> {
  try {
    const parsed = z.array(NoteSchema).safeParse(JSON.parse(await readFile(FILE, "utf8")));
    return parsed.success ? parsed.data : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function save(notes: Note[]) {
  await mkdir(dirname(FILE), { recursive: true });
  await writeFile(`${FILE}.tmp`, JSON.stringify(notes, null, 2), "utf8");
  await rename(`${FILE}.tmp`, FILE);
}

export function listNotes() {
  return serialized(async () => ({ notes: await load() }));
}

export function setNote(key: string, text: string) {
  return serialized(async () => {
    const notes = (await load()).filter((note) => note.key !== key);
    if (text.trim()) notes.push({ key, text, updatedAt: new Date().toISOString() });
    await save(notes);
    return { notes };
  });
}
