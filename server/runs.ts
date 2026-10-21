import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { RunState } from "../shared/contracts";

const FINAL_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

const text = z.string().nullish().transform((value) => value ?? null);
const integer = z.number().int().nullish().transform((value) => value ?? null);

const RunFileSchema = z.object({
  version: z.literal(1),
  runId: z.string().min(1),
  repo: text,
  kind: z.enum(["pr", "issue", "scratch", "intake"]).nullish().transform((value) => (value === "intake" ? "scratch" : (value ?? null))),
  number: integer,
  pr: integer,
  title: text,
  workspaceTitle: text,
  coordinatorAgentId: text,
  worktree: text,
  state: z.enum(["in-progress", "blocked", "final"]),
  round: integer,
  stage: text,
  lastCompleted: text,
  next: text,
  score: z.number().nullish().transform((value) => value ?? null),
  scoreTarget: z.number().nullish().transform((value) => value ?? null),
  result: text,
  blocker: text,
  needsUser: text,
  statusCommentUrl: text,
  children: z
    .array(
      z.object({
        repo: z.string(),
        number: z.number().int(),
        url: text,
        title: text,
        role: text,
        state: text,
        dependsOn: z.array(z.string()).nullish().transform((value) => value ?? []),
        deliverAgentId: text,
      }),
    )
    .nullish()
    .transform((value) => value ?? []),
  startedAt: text,
  updatedAt: z.string().min(1),
});

export function defaultRunStateDir(): string {
  return join(homedir(), ".paseo-dev-team", "runs");
}

export async function readRuns(configuredDir: string) {
  const dir = configuredDir.trim() || defaultRunStateDir();
  const runs: RunState[] = [];
  const errors: string[] = [];
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { dir, runs, errors };
    return { dir, runs, errors: [`${dir}: ${(error as Error).message}`] };
  }
  const now = Date.now();
  await Promise.all(
    names.map(async (name) => {
      const file = join(dir, name);
      try {
        const info = await stat(file);
        const raw = JSON.parse((await readFile(file, "utf8")).replace(/^﻿/, ""));
        const parsed = RunFileSchema.safeParse(raw);
        if (!parsed.success) {
          errors.push(`${name}: ${parsed.error.issues[0]?.message ?? "invalid run state"}`);
          return;
        }
        if (parsed.data.state === "final" && now - info.mtimeMs > FINAL_RETENTION_MS) return;
        const { version: _version, ...run } = parsed.data;
        runs.push({ ...run, file });
      } catch (error) {
        errors.push(`${name}: ${(error as Error).message}`);
      }
    }),
  );
  runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { dir, runs, errors };
}
