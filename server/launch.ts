import type { PaseoApi } from "@getpaseo/client";
import type { BoardAction, Item, Repo } from "../shared/contracts";
import { actionApplies, renderTemplate } from "../shared/actions";
import { ACTION_LABEL, INTAKE_LABEL, ITEM_LABEL, normalizePath } from "../shared/model";
import { prepareUploads, type IncomingFile, type PreparedUploads } from "./uploads";

interface ProfileLike {
  id: string;
  name?: string;
  provider?: string;
  model?: string | null;
  modeId?: string | null;
  thinkingOptionId?: string | null;
  featureValues?: Record<string, unknown> | null;
}

export async function listProfiles(paseo: PaseoApi): Promise<ProfileLike[]> {
  const { config } = await paseo.config.get();
  return ((config as { agentProfiles?: ProfileLike[] }).agentProfiles ?? []).filter((profile) => profile.provider);
}

interface RunInput {
  action: BoardAction;
  item: Item;
  input: string;
  repos: readonly Repo[];
  rootPath: string | null;
}

async function target(paseo: PaseoApi, { action, item, repos, rootPath }: RunInput) {
  if (action.location === "repo") {
    const repo = repos.find((candidate) => candidate.github?.toLowerCase() === item.repo.toLowerCase());
    if (!repo) throw new Error(`${item.repo} has no local checkout registered in Paseo under the board root.`);
    return { path: repo.path, projectId: repo.projectId };
  }
  if (!rootPath) throw new Error(`Set the board root folder, or make "${action.label}" run in the repository.`);
  const { projects } = await paseo.projects.list({});
  const root = normalizePath(rootPath);
  const project = projects.find((candidate) => normalizePath(candidate.projectRootPath) === root);
  return { path: rootPath, projectId: project?.projectId };
}

export async function runAction(paseo: PaseoApi, run: RunInput) {
  const { action, item, input } = run;
  if (!actionApplies(action, item)) {
    throw new Error(`"${action.label}" does not apply to ${item.kind === "pr" ? "PRs" : "issues"}.`);
  }
  const profileId = action.profile.trim();
  if (!profileId) throw new Error(`Choose a profile for "${action.label}" in the board settings.`);
  const profile = (await listProfiles(paseo)).find((candidate) => candidate.id === profileId);
  if (!profile?.provider) {
    throw new Error(`Profile ${profileId} is missing. Install it or change "${action.label}" in the board settings.`);
  }
  const prompt = renderTemplate(action.prompt, action, item, input);
  const title = renderTemplate(action.workspaceTitle, action, item, input) || `${action.label} ${item.repo}#${item.number}`;
  const { path, projectId } = await target(paseo, run);
  return startAgent(paseo, {
    path,
    projectId,
    profile: { ...profile, provider: profile.provider },
    title,
    prompt,
    labels: { [ITEM_LABEL]: `${item.repo}#${item.number}`, [ACTION_LABEL]: action.id },
  });
}

interface StartInput {
  path: string;
  projectId: string | undefined;
  profile: ProfileLike & { provider: string };
  title: string;
  prompt: string;
  labels: Record<string, string>;
  uploads?: PreparedUploads;
}

async function startAgent(paseo: PaseoApi, { path, projectId, profile, title, prompt, labels, uploads }: StartInput) {
  const workspace = await paseo.workspaces.create({
    title,
    source: { kind: "directory", path, ...(projectId ? { projectId } : {}) },
  });
  const agent = await workspace.agents.create({
    config: {
      provider: profile.model ? `${profile.provider}/${profile.model}` : profile.provider,
      ...(profile.modeId ? { modeId: profile.modeId } : {}),
      ...(profile.thinkingOptionId ? { thinkingOptionId: profile.thinkingOptionId } : {}),
      ...(profile.featureValues ? { featureValues: profile.featureValues } : {}),
    },
    title,
    labels,
    prompt,
    ...(uploads?.images.length ? { images: uploads.images } : {}),
    ...(uploads?.attachments.length ? { attachments: uploads.attachments } : {}),
  });
  return { workspaceId: workspace.id, agentId: agent.id ?? null, prompt };
}

function intakeTitle(description: string): string {
  const line = description.trim().split(/\r?\n/)[0]?.trim() ?? "";
  const sentence = line.split(/(?<=[.!?])\s/)[0] ?? line;
  const words = sentence.replace(/[.!?:;]+$/, "").split(/\s+/).filter(Boolean);
  const summary = words.slice(0, 7).join(" ");
  return summary ? `Scratch (${summary}${words.length > 7 ? "…" : ""})` : "Scratch";
}

interface IntakeInput {
  description: string;
  attachments: readonly IncomingFile[];
  profileId: string;
  promptTemplate: string;
  rootPath: string | null;
}

export async function launchIntake(paseo: PaseoApi, input: IntakeInput) {
  if (!input.rootPath) throw new Error("Set the board root folder first: scratch runs from the folder that holds all repositories.");
  const profile = (await listProfiles(paseo)).find((candidate) => candidate.id === input.profileId);
  if (!profile?.provider) throw new Error(`Profile ${input.profileId} is missing. Install paseo-dev-team or change it in the board settings.`);
  const text = input.description.trim();
  const prompt = input.promptTemplate.includes("{input}")
    ? input.promptTemplate.replace("{input}", () => text)
    : `${input.promptTemplate} ${text}`;
  const { projects } = await paseo.projects.list({});
  const root = normalizePath(input.rootPath);
  const project = projects.find((candidate) => normalizePath(candidate.projectRootPath) === root);
  return startAgent(paseo, {
    path: input.rootPath,
    projectId: project?.projectId,
    profile: { ...profile, provider: profile.provider },
    title: intakeTitle(input.description),
    prompt,
    labels: { [INTAKE_LABEL]: "1" },
    uploads: await prepareUploads(input.attachments),
  });
}
