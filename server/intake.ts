import type { PaseoApi } from "@getpaseo/client";
import { execCommand } from "@getpaseo/plugin/server";
import type { BoardAction, Item, Repo } from "../shared/contracts";
import { forgetItem, removeLabel } from "./items";
import { runAction } from "./launch";

interface ApproveInput {
  intakeAgentId: string | null;
  notify: boolean;
  items: Item[];
  instructions: string;
  draftLabel: string;
  deliver: BoardAction;
  repos: readonly Repo[];
  rootPath: string | null;
}

async function notify(paseo: PaseoApi, agentId: string | null, message: string) {
  if (!agentId) return;
  try {
    await paseo.agents.ref(agentId).send(message, { activeTurnBehavior: "steer" });
  } catch {
    // The coordinator may be closed; the board result stands on its own.
  }
}

export async function approveIntake(paseo: PaseoApi, input: ApproveInput) {
  const started: { key: string; agentId: string | null; prompt: string }[] = [];
  const failed: { key: string; error: string }[] = [];
  for (const item of input.items) {
    const key = `${item.repo}#${item.number}`;
    try {
      if (item.labels.includes(input.draftLabel)) await removeLabel(item.repo, item.number, input.draftLabel);
      const result = await runAction(paseo, {
        action: input.deliver,
        item: { ...item, labels: item.labels.filter((label) => label !== input.draftLabel) },
        input: input.instructions,
        repos: input.repos,
        rootPath: input.rootPath,
      });
      started.push({ key, agentId: result.agentId, prompt: result.prompt });
    } catch (error) {
      failed.push({ key, error: (error as Error).message.split("\n")[0] });
    }
  }
  if (started.length && input.notify) {
    await notify(
      paseo,
      input.intakeAgentId,
      [
        "The user approved these issues on the Agent board. The board started a deliver coordinator for each:",
        ...started.map((entry) => `- ${entry.key} (deliver agent ${entry.agentId ?? "unknown"})`),
        ...(failed.length ? ["Not started:", ...failed.map((entry) => `- ${entry.key}: ${entry.error}`)] : []),
        "Do not start deliver for them again. Record them as delivering with their deliver agent IDs in the run state, and finish the run once no other issue of this run awaits a decision.",
      ].join("\n"),
    );
  }
  return { started, failed };
}

export async function rejectIntakeItem(paseo: PaseoApi, intakeAgentId: string | null, item: Item, draftLabel: string, shouldNotify: boolean) {
  await execCommand("gh", ["issue", "close", String(item.number), "-R", item.repo, "--reason", "not planned"], { timeout: 30000 });
  forgetItem(item.repo, item.number);
  if (shouldNotify) await notify(
    paseo,
    intakeAgentId,
    `The user rejected ${item.repo}#${item.number} on the Agent board; the board closed it as not planned. Do not deliver it; record it as cancelled in the run state.`,
  );
  return { ok: true, draftLabel };
}

export async function requestIntakeChanges(paseo: PaseoApi, intakeAgentId: string, text: string) {
  await paseo.agents
    .ref(intakeAgentId)
    .send(`Change requests for the issues from the user (Agent board):\n\n${text}\n\nEdit the issues accordingly and report what changed.`);
  return { ok: true };
}
