import { execCommand } from "@getpaseo/plugin/server";
import type { PrStatus } from "../shared/contracts";

const MARKER = /<!--\s*(?:deliver|pr-ready)-status:v1\b([^>]*)-->/;

interface CheckItem {
  name?: string;
  context?: string;
  status?: string;
  conclusion?: string;
  state?: string;
}

interface Comment {
  body: string;
  url: string;
  createdAt: string;
}

interface PrView {
  url: string;
  title: string;
  state: string;
  isDraft: boolean;
  reviewDecision: string | null;
  mergeable: string | null;
  headRefName: string;
  statusCheckRollup: CheckItem[] | null;
  comments: Comment[] | null;
}

function summarizeChecks(items: readonly CheckItem[]) {
  const checks = { passed: 0, failed: 0, pending: 0, failedNames: [] as string[] };
  for (const item of items) {
    const outcome = (item.conclusion || item.state || item.status || "").toUpperCase();
    if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(outcome)) checks.passed += 1;
    else if (["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(outcome)) {
      checks.failed += 1;
      checks.failedNames.push(item.name ?? item.context ?? "check");
    } else checks.pending += 1;
  }
  return checks;
}

export function parseDeliverComment(comments: readonly Comment[]): PrStatus["deliver"] {
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    const comment = comments[index];
    const marker = MARKER.exec(comment.body);
    if (!marker) continue;
    const state = /\bstate=(\S+)/.exec(marker[1])?.[1] ?? "unknown";
    const score = /\*\*Score:\s*(\d+(?:\.\d+)?)\s*\/\s*10\*\*/i.exec(comment.body) ?? /Score:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i.exec(comment.body);
    return { state, score: score ? Number(score[1]) : null, commentUrl: comment.url, updatedAt: comment.createdAt };
  }
  return null;
}

export async function readPrStatus(repo: string, number: number): Promise<PrStatus> {
  const fields = "url,title,state,isDraft,reviewDecision,mergeable,headRefName,statusCheckRollup,comments";
  let stdout: string;
  try {
    ({ stdout } = await execCommand("gh", ["pr", "view", String(number), "-R", repo, "--json", fields], {
      timeout: 30000,
      maxBuffer: 32 * 1024 * 1024,
    }));
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(stderr || `gh pr view failed for ${repo}#${number}`);
  }
  const view = JSON.parse(stdout) as PrView;
  return {
    url: view.url,
    title: view.title,
    state: view.state,
    isDraft: view.isDraft,
    reviewDecision: view.reviewDecision || null,
    mergeable: view.mergeable || null,
    headRefName: view.headRefName,
    checks: summarizeChecks(view.statusCheckRollup ?? []),
    deliver: parseDeliverComment(view.comments ?? []),
  };
}
