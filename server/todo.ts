import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { itemKey, TodoSchema, type Item, type Todo } from "../shared/contracts";

const FILE = join(homedir(), ".paseo-agent-board", "todo.json");

let queue: Promise<unknown> = Promise.resolve();

function serialized<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task);
  queue = result.catch(() => undefined);
  return result;
}

async function load(): Promise<Todo[]> {
  try {
    const parsed = z.array(TodoSchema).safeParse(JSON.parse(await readFile(FILE, "utf8")));
    return parsed.success ? parsed.data : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function save(todos: Todo[]) {
  await mkdir(dirname(FILE), { recursive: true });
  await writeFile(`${FILE}.tmp`, JSON.stringify(todos, null, 2), "utf8");
  await rename(`${FILE}.tmp`, FILE);
}

export function listTodos() {
  return serialized(async () => ({ todos: await load() }));
}

export function addTodo(item: Item) {
  return serialized(async () => {
    const todos = await load();
    if (!todos.some((todo) => itemKey(todo.repo, todo.number) === itemKey(item.repo, item.number))) {
      todos.push({
        repo: item.repo,
        number: item.number,
        kind: item.kind,
        title: item.title,
        url: item.url,
        addedAt: new Date().toISOString(),
      });
      await save(todos);
    }
    return { todos };
  });
}

export function removeTodo(repo: string, number: number) {
  return serialized(async () => {
    const todos = (await load()).filter((todo) => itemKey(todo.repo, todo.number) !== itemKey(repo, number));
    await save(todos);
    return { todos };
  });
}
