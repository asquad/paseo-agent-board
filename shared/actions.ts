import type { BoardAction, Item } from "./contracts";

export interface ItemReference {
  repo: string | null;
  number: number;
  kind: "pr" | "issue" | null;
}

export function parseReference(reference: string): ItemReference | null {
  const text = reference.trim();
  const url = /github\.com\/([^/\s]+\/[^/\s]+)\/(pull|issues)\/(\d+)/.exec(text);
  if (url) return { repo: url[1], number: Number(url[3]), kind: url[2] === "pull" ? "pr" : "issue" };
  const short = /^(?:([\w.-]+\/[\w.-]+))?#?(\d+)$/.exec(text);
  if (short) return { repo: short[1] ?? null, number: Number(short[2]), kind: null };
  return null;
}

export function actionApplies(action: BoardAction, item: Pick<Item, "kind">): boolean {
  return action.targets === "both" || action.targets === item.kind;
}

export function renderTemplate(template: string, action: BoardAction, item: Item, input: string): string {
  const values: Record<string, string> = {
    url: item.url,
    number: String(item.number),
    repo: item.repo,
    repoName: item.repo.split("/").pop() ?? item.repo,
    owner: item.repo.split("/")[0] ?? "",
    kind: item.kind === "pr" ? "PR" : "issue",
    title: item.title,
    label: action.label,
    input: input.trim(),
  };
  return template
    .replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
    .replace(/[ \t]+$/gm, "")
    .trim();
}
