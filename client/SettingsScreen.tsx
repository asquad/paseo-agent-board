import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { boardSettings, DEFAULT_ACTIONS, DEFAULT_CLEANUP_PROMPT, reposRpc, type BoardAction, type BoardSettingsValues } from "../shared/contracts";

const PLACEHOLDERS = "{url} {number} {repo} {repoName} {owner} {kind} {title} {input}";

function newAction(existing: readonly BoardAction[]): BoardAction {
  let index = existing.length + 1;
  while (existing.some((action) => action.id === `action-${index}`)) index += 1;
  return {
    id: `action-${index}`,
    label: "New action",
    icon: "Play",
    targets: "both",
    profile: "",
    location: "root",
    prompt: "{url}",
    askForInput: false,
    workspaceTitle: "{label} {repoName} #{number}",
  };
}

function ActionEditor({
  action,
  profiles,
  onChange,
  onRemove,
}: {
  action: BoardAction;
  profiles: readonly { id: string; name: string }[];
  onChange(patch: Partial<BoardAction>): void;
  onRemove(): void;
}) {
  const options = profiles.map((profile) => ({ label: profile.name, value: profile.id }));
  if (!options.some((option) => option.value === action.profile)) {
    options.unshift({ label: action.profile ? `${action.profile} (missing)` : "Choose a profile", value: action.profile });
  }
  return (
    <SettingsCard>
      <SettingsInput label="Button label" initialValue={action.label} onChangeText={(label) => onChange({ label })} />
      <SettingsInput
        label="Icon"
        hint="A Lucide icon name, for example Rocket, Bot, Search, Wrench."
        initialValue={action.icon}
        onChangeText={(icon) => onChange({ icon })}
      />
      <SettingsSelect
        label="Shown on"
        value={action.targets}
        options={[
          { label: "PRs and issues", value: "both" },
          { label: "PRs only", value: "pr" },
          { label: "Issues only", value: "issue" },
        ]}
        onValueChange={(targets) => onChange({ targets })}
      />
      <SettingsSelect label="Agent profile" value={action.profile} options={options} onValueChange={(profile) => onChange({ profile })} />
      <SettingsSelect
        label="Start the agent in"
        value={action.location}
        options={[
          { label: "The board root folder", value: "root" },
          { label: "The PR's or issue's repository", value: "repo" },
        ]}
        onValueChange={(location) => onChange({ location })}
      />
      <SettingsInput
        label="Prompt"
        hint={`Placeholders: ${PLACEHOLDERS}.`}
        initialValue={action.prompt}
        onChangeText={(prompt) => onChange({ prompt })}
      />
      <SettingsSwitch
        label="Ask for instructions"
        hint="Show a text field before starting; its text replaces {input}."
        value={action.askForInput}
        onValueChange={(askForInput) => onChange({ askForInput })}
      />
      <SettingsInput
        label="Workspace title"
        hint="Same placeholders, plus {label}."
        initialValue={action.workspaceTitle}
        onChangeText={(workspaceTitle) => onChange({ workspaceTitle })}
      />
      <SettingsAction label={`Remove "${action.label}"`} actionLabel="Remove" onPress={onRemove} />
    </SettingsCard>
  );
}

export function SettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(boardSettings);
  const listRepos = useRpc(reposRpc);
  const profiles = useQuery({ queryKey: ["settings-profiles"], queryFn: () => listRepos({}) });
  const [draft, setDraft] = useState<BoardSettingsValues | null>(null);
  const values = settings.status === "ready" ? settings.values : null;

  useEffect(() => {
    if (values) setDraft(values);
  }, [values]);

  if (settings.status === "loading" || (settings.status === "ready" && !draft)) {
    return <Text style={{ color: theme.colors.foregroundMuted }}>Loading…</Text>;
  }
  if (settings.status === "error") return <Text style={{ color: theme.colors.statusDanger }}>{settings.error}</Text>;
  const current: BoardSettingsValues = draft ?? {
    rootPath: "",
    title: "",
    showWorkers: true,
    actions: DEFAULT_ACTIONS,
    deliverEnabled: true,
    runStateDir: "",
    intakeProfile: "team-coordinator",
    intakePrompt: "/scratch {input}",
    cleanupPrompt: DEFAULT_CLEANUP_PROMPT,
    draftLabel: "draft",
  };
  const update = (patch: Partial<BoardSettingsValues>) => setDraft({ ...current, ...patch });
  const updateAction = (id: string, patch: Partial<BoardAction>) =>
    update({ actions: current.actions.map((action) => (action.id === id ? { ...action, ...patch } : action)) });

  return (
    <View style={{ gap: 16 }}>
      <SettingsSection title="Workspace">
        <SettingsCard>
          <SettingsInput
            label="Root folder"
            hint="Projects and agents under this folder appear on the board. Leave empty for every project."
            initialValue={current.rootPath}
            placeholder="D:\\workspace\\projects"
            onChangeText={(rootPath) => update({ rootPath })}
          />
          <SettingsInput
            label="Board name"
            hint="Defaults to the root folder name."
            initialValue={current.title}
            onChangeText={(title) => update({ title })}
          />
          <SettingsSwitch
            label="Show workers"
            hint="List the subagents of a coordinator in its details."
            value={current.showWorkers}
            onValueChange={(showWorkers) => update({ showWorkers })}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="PR and issue actions">
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          Buttons shown on PRs and issues in the board. Each starts an agent with the chosen profile and prompt in a new
          workspace.
        </Text>
        {profiles.error ? (
          <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>{(profiles.error as Error).message}</Text>
        ) : null}
        {current.actions.map((action) => (
          <ActionEditor
            key={action.id}
            action={action}
            profiles={profiles.data?.profiles ?? []}
            onChange={(patch) => updateAction(action.id, patch)}
            onRemove={() => update({ actions: current.actions.filter((candidate) => candidate.id !== action.id) })}
          />
        ))}
        <SettingsCard>
          <SettingsAction
            label="Add a button"
            actionLabel="Add"
            onPress={() => update({ actions: [...current.actions, newAction(current.actions)] })}
          />
          <SettingsAction
            label="Add the default Deliver button (paseo-dev-team)"
            actionLabel="Add"
            disabled={current.actions.some((action) => action.id === "deliver")}
            onPress={() => update({ actions: [...current.actions, ...DEFAULT_ACTIONS] })}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="paseo-dev-team">
        <SettingsCard>
          <SettingsSwitch
            label="Integration"
            hint="Track /deliver and /scratch runs (stage, score, blocker, created issues) and show Deliver from scratch. Needs paseo-dev-team; without it, turn this off."
            value={current.deliverEnabled}
            onValueChange={(deliverEnabled) => update({ deliverEnabled })}
          />
          <SettingsInput
            label="Run state folder"
            hint="Where deliver coordinators write run state. Defaults to ~/.paseo-dev-team/runs."
            initialValue={current.runStateDir}
            disabled={!current.deliverEnabled}
            onChangeText={(runStateDir) => update({ runStateDir })}
          />
          <SettingsSelect
            label="Deliver from scratch profile"
            value={current.intakeProfile}
            options={(() => {
              const options = (profiles.data?.profiles ?? []).map((profile) => ({ label: profile.name, value: profile.id }));
              if (!options.some((option) => option.value === current.intakeProfile)) {
                options.unshift({ label: `${current.intakeProfile || "none"} (missing)`, value: current.intakeProfile });
              }
              return options;
            })()}
            onValueChange={(intakeProfile) => update({ intakeProfile })}
          />
          <SettingsInput
            label="Deliver from scratch prompt"
            hint="{input} is the description."
            initialValue={current.intakePrompt}
            disabled={!current.deliverEnabled}
            onChangeText={(intakePrompt) => update({ intakePrompt })}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Архивирование">
        <SettingsCard>
          <SettingsInput
            label="Cleanup prompt"
            hint="Sent to an agent before it is archived; the board archives it only after that turn finishes. Leave empty to archive immediately."
            initialValue={current.cleanupPrompt}
            onChangeText={(cleanupPrompt) => update({ cleanupPrompt })}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsCard>
        <SettingsAction
          label={settings.status === "invalid" ? `Stored settings are invalid: ${settings.error}` : "Save changes"}
          error={settings.saveError}
          actionLabel={settings.saving ? "Saving…" : "Save"}
          disabled={settings.saving || settings.status !== "ready"}
          onPress={() => {
            if (settings.status === "ready") void settings.save(current, settings.revision);
          }}
        />
        <SettingsAction label="Restore defaults" actionLabel="Reset" disabled={settings.saving} onPress={() => void settings.reset()} />
      </SettingsCard>
    </View>
  );
}
