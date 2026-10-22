import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, usePaseo, useRpc } from "@getpaseo/plugin/client";
import { Icon, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  archiveRunsRpc,
  approveIntakeRpc,
  archiveTaskRpc,
  DELIVER_ACTION_ID,
  rejectIntakeItemRpc,
  requestIntakeChangesRpc,
  resolveItemRpc,
  setAssignmentsRpc,
  setDismissedRpc,
  setNoteRpc,
  type BoardAction,
  type Item,
} from "../shared/contracts";
import { parseReference } from "../shared/actions";
import { formatAge, type BoardWorkspace } from "../shared/model";
import { PHASES, type IntakePhase, type WorkItem } from "../shared/work";
import { ActionButtons } from "./ActionButtons";
import { LabelList } from "./LabelChip";
import { PrBadge } from "./PrBadge";
import { Picker, type FilterOption } from "./FilterBar";
import { workStatusColor, type Styles } from "./styles";
import { StatusMark, workMark } from "./StatusMark";
import { AgentSection, Button, DeliverCard, type Navigation } from "./TaskDetail";
import { useCleanupJobs, useNotes } from "./data";
import { useTodoToggle } from "./view";

interface Props {
  item: WorkItem;
  theme: PluginTheme;
  styles: Styles;
  now: number;
  showWorkers: boolean;
  actions: readonly BoardAction[];
  profiles: ReadonlySet<string>;
  navigation: Navigation | undefined;
  onStarted(agentId: string | null): void;
  onBack?: () => void;
  repoOptions: readonly FilterOption[];
  allWork: readonly WorkItem[];
  onSelect(key: string): void;
  dismissedAt: string | null;
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function useItem(work: WorkItem): Item | null {
  const resolve = useRpc(resolveItemRpc);
  const reference = work.repo && work.number !== null ? `${work.repo}#${work.number}` : null;
  const resolved = useQuery({
    queryKey: ["resolve", reference, null],
    queryFn: () => resolve({ reference: reference ?? "", defaultRepo: null }),
    enabled: Boolean(reference) && !work.meta,
    staleTime: 10 * 60_000,
    retry: false,
  });
  return work.meta ?? resolved.data ?? null;
}

function Pipeline({ phase, styles, theme }: { phase: IntakePhase; styles: Styles; theme: PluginTheme }) {
  const current = PHASES.findIndex((step) => step.id === phase);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
      {PHASES.map((step, index) => {
        const done = index < current;
        const active = index === current;
        const color = active ? theme.colors.accent : done ? theme.colors.statusSuccess : theme.colors.foregroundMuted;
        return (
          <View key={step.id} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            {index > 0 ? <Icon name="ChevronRight" size={12} color={theme.colors.foregroundMuted} /> : null}
            <Icon name={done ? "CircleCheck" : active ? "CircleDot" : "Circle"} size={13} color={color} />
            <Text style={[styles.muted, { color }, active ? { fontWeight: "600" } : null]}>{step.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

function IntakeCard({
  work,
  allWork,
  deliverReady,
  styles,
  theme,
  onSelect,
}: {
  work: WorkItem;
  allWork: readonly WorkItem[];
  deliverReady: boolean;
  styles: Styles;
  theme: PluginTheme;
  onSelect(key: string): void;
}) {
  const approve = useRpc(approveIntakeRpc);
  const reject = useRpc(rejectIntakeItemRpc);
  const changes = useRpc(requestIntakeChangesRpc);
  const client = useQueryClient();
  const toast = useToast();
  const run = work.run;
  const coordinatorId = work.tasks[0]?.agent.id ?? run?.coordinatorAgentId ?? null;
  const waiting = run?.state === "blocked" && coordinatorId !== null;
  const pendingKeys = work.pending.map((item) => `${item.repo}#${item.number}`);
  const [selected, setSelected] = useState<string[] | null>(null);
  const chosen = selected ?? pendingKeys;
  const [instructions, setInstructions] = useState("");
  const [changeText, setChangeText] = useState<string | null>(null);
  const [confirmReject, setConfirmReject] = useState<string | null>(null);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["meta"] });
    void client.invalidateQueries({ queryKey: ["agent-repos"] });
  };

  const approveMutation = useMutation({
    mutationFn: () =>
      approve({
        intakeAgentId: coordinatorId,
        notify: waiting,
        items: work.pending.filter((item) => chosen.includes(`${item.repo}#${item.number}`)),
        instructions: instructions.trim(),
      }),
    onSuccess: (result) => {
      setSelected(null);
      refresh();
      if (result.started.length) toast.show(`Deliver запущен: ${result.started.map((entry) => entry.key).join(", ")}`, { variant: "success" });
      for (const entry of result.failed) toast.error(`${entry.key}: ${entry.error}`);
    },
    onError: (error) => toast.error((error as Error).message),
  });
  const rejectMutation = useMutation({
    mutationFn: (item: Item) => reject({ intakeAgentId: coordinatorId, item, notify: waiting }),
    onSuccess: () => {
      setConfirmReject(null);
      refresh();
      toast.show("Issue закрыта как not planned", { variant: "success" });
    },
    onError: (error) => toast.error((error as Error).message),
  });
  const changesMutation = useMutation({
    mutationFn: (text: string) => changes({ intakeAgentId: coordinatorId ?? "", text }),
    onSuccess: () => {
      setChangeText(null);
      toast.show("Правки отправлены координатору", { variant: "success" });
    },
    onError: (error) => toast.error((error as Error).message),
  });

  const delivered = work.childKeys.map((key) => allWork.find((item) => item.key === key)).filter((item): item is WorkItem => Boolean(item));
  const closed = work.childItems.filter((item) => item.state !== "open" && !delivered.some((child) => child.number === item.number && child.repo?.toLowerCase() === item.repo.toLowerCase()));
  const toggle = (key: string) => setSelected(chosen.includes(key) ? chosen.filter((value) => value !== key) : [...chosen, key]);
  const busy = approveMutation.isPending || rejectMutation.isPending;

  return (
    <View style={styles.card}>
      <Pipeline phase={work.phase ?? "analysis"} styles={styles} theme={theme} />
      {run?.needsUser && work.phase !== "approve" ? (
        <Text style={[styles.text, { color: theme.colors.statusWarning }]}>{run.needsUser}</Text>
      ) : null}
      {run?.lastCompleted ? <Text style={styles.muted}>{run.lastCompleted}</Text> : null}

      {work.phase === "analysis" ? (
        <Text style={styles.text}>Координатор разбирает задачу по репозиториям и готовит issues. Они появятся здесь.</Text>
      ) : null}

      {work.pending.length ? (
        <View style={{ gap: 8 }}>
          <Text style={styles.strong}>Проверьте issues и подтвердите нужные</Text>
          {work.pending.map((item) => {
            const key = `${item.repo}#${item.number}`;
            const checked = chosen.includes(key);
            return (
              <View key={key} style={[styles.row, { paddingHorizontal: 0, flexWrap: "wrap" }]}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                  accessibilityLabel={`Выбрать ${key}`}
                  onPress={() => toggle(key)}
                  style={{ padding: 2 }}
                >
                  <Icon name={checked ? "SquareCheck" : "Square"} size={17} color={checked ? theme.colors.accent : theme.colors.foregroundMuted} />
                </Pressable>
                <Icon name={item.kind === "pr" ? "GitPullRequest" : "CircleDot"} size={14} color={theme.colors.foregroundMuted} />
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={`Открыть ${key} на GitHub`}
                  onPress={() => void openExternalUrl(item.url)}
                  style={{ flex: 1, minWidth: 180 }}
                >
                  <Text style={styles.text} numberOfLines={2}>
                    {item.repo.split("/").pop()} #{item.number} {item.title}
                  </Text>
                  {item.labels.length ? (
                    <LabelList labels={item.labels} colors={item.labelColors} fallback={theme.colors.foregroundMuted} />
                  ) : (
                    <Text style={styles.muted}>без меток</Text>
                  )}
                </Pressable>
                <Button styles={styles} theme={theme} icon="ExternalLink" label="GitHub" onPress={() => void openExternalUrl(item.url)} />
                <Button
                  styles={styles}
                  theme={theme}
                  icon={confirmReject === key ? "AlertTriangle" : "X"}
                  label={confirmReject === key ? "Закрыть issue?" : "Отклонить"}
                  disabled={busy}
                  onPress={() => (confirmReject === key ? rejectMutation.mutate(item) : setConfirmReject(key))}
                />
              </View>
            );
          })}
          <TextInput
            accessibilityLabel="Параметры deliver"
            placeholder="Параметры deliver (необязательно): target 9, no-post, base staging"
            placeholderTextColor={theme.colors.foregroundMuted}
            value={instructions}
            onChangeText={setInstructions}
            style={styles.input}
          />
          <View style={[styles.headerRow, { flexWrap: "wrap" }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Подтвердить выбранные issues и запустить deliver"
              disabled={busy || !chosen.length || !deliverReady}
              onPress={() => approveMutation.mutate()}
              style={[styles.primary, busy || !chosen.length || !deliverReady ? { opacity: 0.5 } : null]}
            >
              <Icon name="Rocket" size={14} color={theme.colors.accentForeground} />
              <Text style={styles.primaryText}>
                {approveMutation.isPending ? "Запускаю…" : `Подтвердить и запустить (${chosen.length})`}
              </Text>
            </Pressable>
            {coordinatorId ? (
              <Button
                styles={styles}
                theme={theme}
                icon="MessageSquareDiff"
                label="Попросить изменения"
                disabled={busy}
                onPress={() => setChangeText(changeText === null ? "" : null)}
              />
            ) : null}
          </View>
          {!deliverReady ? <Text style={styles.error}>Кнопка Deliver не настроена или её профиль не найден (Settings → Agent board).</Text> : null}
          {changeText !== null ? (
            <View style={{ gap: 6 }}>
              <TextInput
                accessibilityLabel="Что изменить в issues"
                placeholder="Что поменять: разбиение, критерии, репозиторий, формулировки…"
                placeholderTextColor={theme.colors.foregroundMuted}
                multiline
                value={changeText}
                onChangeText={setChangeText}
                style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]}
              />
              <View style={styles.headerRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Отправить правки координатору"
                  disabled={!changeText.trim() || changesMutation.isPending}
                  onPress={() => changesMutation.mutate(changeText.trim())}
                  style={[styles.primary, !changeText.trim() || changesMutation.isPending ? { opacity: 0.5 } : null]}
                >
                  <Icon name="Send" size={14} color={theme.colors.accentForeground} />
                  <Text style={styles.primaryText}>Отправить</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      {delivered.length ? (
        <View style={{ gap: 2 }}>
          <Text style={styles.strong}>В работе</Text>
          {delivered.map((child) => (
            <Pressable
              key={child.key}
              accessibilityRole="button"
              accessibilityLabel={`Открыть ${child.title}`}
              onPress={() => onSelect(child.key)}
              style={[styles.row, { paddingHorizontal: 0 }]}
            >
              <StatusMark theme={theme} kind={workMark(child.status)} />
              <Text style={[styles.text, { flex: 1 }]} numberOfLines={1}>
                {child.title}
              </Text>
              <Text style={styles.muted} numberOfLines={1}>
                {child.statusText}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {closed.length ? (
        <View style={{ gap: 2 }}>
          <Text style={styles.strong}>Закрыты</Text>
          {closed.map((item) => (
            <Pressable
              key={`${item.repo}#${item.number}`}
              accessibilityRole="link"
              accessibilityLabel={`Открыть ${item.repo}#${item.number}`}
              onPress={() => void openExternalUrl(item.url)}
              style={[styles.row, { paddingHorizontal: 0 }]}
            >
              <Icon name="CircleSlash" size={13} color={theme.colors.foregroundMuted} />
              <Text style={[styles.muted, { flex: 1 }]} numberOfLines={1}>
                {item.repo.split("/").pop()} #{item.number} {item.title}
              </Text>
              <Text style={styles.muted}>{item.state}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function useDismissToggle(work: WorkItem, allWork: readonly WorkItem[]) {
  const save = useRpc(setDismissedRpc);
  const client = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (dismissed: boolean) => {
      const keys = new Set<string>([work.key]);
      let added = true;
      while (added) {
        added = false;
        for (const item of allWork) {
          if (item.parentKey && keys.has(item.parentKey) && !keys.has(item.key)) {
            keys.add(item.key);
            added = true;
          }
        }
      }
      return save({ keys: [...keys], dismissed });
    },
    onSuccess: (result, dismissed) => {
      client.setQueryData(["dismissed"], result);
      toast.show(dismissed ? "Убрано с доски" : "Возвращено на доску", { variant: "success" });
    },
    onError: (error) => toast.error((error as Error).message),
  });
}

function liveAgentsIn(work: WorkItem, workspaceId: string): number {
  return work.tasks.flatMap((task) => [task.agent, ...task.workers]).filter((agent) => agent.workspaceId === workspaceId).length;
}

function TaskArchive({ work, styles, theme }: { work: WorkItem; styles: Styles; theme: PluginTheme }) {
  const archive = useRpc(archiveTaskRpc);
  const client = useQueryClient();
  const toast = useToast();
  const jobs = useCleanupJobs();
  const [confirm, setConfirm] = useState(false);
  const agentIds = work.tasks.map((task) => task.agent.id);
  const emptyWorkspaces = work.workspaces.filter((workspace) => liveAgentsIn(work, workspace.id) === 0).map((workspace) => workspace.id);
  const taskJobs = jobs.filter((job) => agentIds.includes(job.agentId));
  const active = taskJobs.some((job) => job.state === "cleaning" || job.state === "archiving");
  const stuck = taskJobs.filter((job) => job.state === "failed" || job.state === "needs-you");
  const running = work.tasks.some((task) => [task.agent, ...task.workers].some((agent) => agent.status === "running"));
  const mutation = useMutation({
    mutationFn: (skipCleanup: boolean) =>
      archive({ agentIds: skipCleanup ? stuck.map((job) => job.agentId) : agentIds, workspaceIds: emptyWorkspaces, skipCleanup }),
    onSuccess: (result) => {
      setConfirm(false);
      void client.invalidateQueries({ queryKey: ["cleanup-jobs"] });
      toast.show(
        result.jobs.length
          ? `Уборка запущена: агентов ${result.jobs.length}${result.archivedWorkspaces ? `, пустых воркспейсов архивировано: ${result.archivedWorkspaces}` : ""}`
          : `Архивировано воркспейсов: ${result.archivedWorkspaces}`,
        { variant: "success" },
      );
    },
    onError: (error) => toast.error((error as Error).message),
  });
  const archiveRun = useRpc(archiveRunsRpc);
  const runMutation = useMutation({
    mutationFn: () => archiveRun({ runs: work.runs }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["archived-runs"] });
      toast.show("Задача архивирована", { variant: "success" });
    },
    onError: (error) => toast.error((error as Error).message),
  });
  if (!agentIds.length && !emptyWorkspaces.length) {
    if (!work.runs.length) return null;
    return (
      <View style={styles.headerRow}>
        <Button
          styles={styles}
          theme={theme}
          icon="Archive"
          label="Архивировать задачу"
          disabled={runMutation.isPending}
          onPress={() => runMutation.mutate()}
        />
      </View>
    );
  }
  return (
    <View style={{ gap: 4 }}>
      <View style={[styles.headerRow, { flexWrap: "wrap" }]}>
        <Button
          styles={styles}
          theme={theme}
          icon={confirm ? "AlertTriangle" : "Archive"}
          label={confirm ? (agentIds.length ? "Уборка и архив задачи?" : "Архивировать воркспейсы?") : "Архивировать задачу"}
          disabled={mutation.isPending || active || running}
          onPress={() => (confirm ? mutation.mutate(false) : setConfirm(true))}
        />
        {stuck.length ? (
          <Button
            styles={styles}
            theme={theme}
            icon="ArchiveX"
            label="Архивировать без cleanup"
            disabled={mutation.isPending}
            onPress={() => mutation.mutate(true)}
          />
        ) : null}
      </View>
      {running ? <Text style={styles.muted}>Агенты ещё работают; архивировать можно после их хода.</Text> : null}
      {taskJobs.map((job) => (
        <Text
          key={job.agentId}
          style={job.state === "failed" ? styles.error : [styles.muted, job.state === "needs-you" ? { color: theme.colors.statusWarning } : null]}
        >
          {work.tasks.find((task) => task.agent.id === job.agentId)?.workspace?.title ?? "Агент"}: {job.message}
        </Text>
      ))}
    </View>
  );
}

function NoteBox({ itemKey, styles, theme }: { itemKey: string; styles: Styles; theme: PluginTheme }) {
  const notes = useNotes();
  const save = useRpc(setNoteRpc);
  const client = useQueryClient();
  const saved = notes.get(itemKey) ?? "";
  const [text, setText] = useState(saved);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const latest = useRef(text);
  latest.current = text;
  const edited = useRef(false);

  useEffect(() => {
    if (!edited.current) setText(saved);
  }, [saved]);

  const persist = async () => {
    const value = latest.current;
    if (value === (client.getQueryData<{ notes: { key: string; text: string }[] }>(["notes"])?.notes.find((note) => note.key === itemKey)?.text ?? "")) return;
    setState("saving");
    try {
      client.setQueryData(["notes"], await save({ key: itemKey, text: value }));
      setState("saved");
    } catch {
      setState("error");
    }
  };

  useEffect(() => {
    if (text === saved) return undefined;
    const timer = setTimeout(() => void persist(), 1200);
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <View style={{ gap: 4 }}>
      <View style={styles.headerRow}>
        <Icon name="StickyNote" size={13} color={theme.colors.foregroundMuted} />
        <Text style={[styles.strong, { flex: 1 }]}>Комментарий</Text>
        <Text style={state === "error" ? styles.error : styles.muted}>
          {state === "saving" ? "сохраняю…" : state === "saved" ? "сохранено" : state === "error" ? "не сохранилось" : ""}
        </Text>
      </View>
      <TextInput
        accessibilityLabel="Комментарий к задаче"
        placeholder="Ваши заметки по задаче: что проверить, кого ждём, договорённости…"
        placeholderTextColor={theme.colors.foregroundMuted}
        multiline
        value={text}
        onChangeText={(value) => {
          edited.current = true;
          setText(value);
          setState("idle");
        }}
        onBlur={() => void persist()}
        style={[styles.input, { minHeight: 60, textAlignVertical: "top" }]}
      />
    </View>
  );
}

function Belonging({
  work,
  repoOptions,
  styles,
  theme,
}: {
  work: WorkItem;
  repoOptions: readonly FilterOption[];
  styles: Styles;
  theme: PluginTheme;
}) {
  const save = useRpc(setAssignmentsRpc);
  const client = useQueryClient();
  const toast = useToast();
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [linkText, setLinkText] = useState("");
  const workspaceIds = work.workspaces.map((workspace) => workspace.id);
  const mutation = useMutation({
    mutationFn: (patch: { repos?: string[] | null; link?: string | null }) => save({ workspaceIds, ...patch }),
    onSuccess: (result) => client.setQueryData(["assignments"], result),
    onError: (error) => toast.error((error as Error).message),
  });
  if (!workspaceIds.length) return null;

  const linkTo = () => {
    const parsed = parseReference(linkText);
    const repo = parsed?.repo ?? (work.repos.length === 1 && work.repos[0].includes("/") ? work.repos[0] : null);
    if (!parsed || !repo) {
      toast.error("Нужна ссылка на PR/issue или owner/repo#123");
      return;
    }
    mutation.mutate({ link: `${repo}#${parsed.number}` });
    setLinkText("");
  };

  return (
    <View style={styles.card}>
      <Text style={styles.strong}>Принадлежность</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
        <Text style={styles.muted}>Репо{work.manualRepos ? " (вручную)" : " (авто)"}:</Text>
        {work.repos.length ? (
          work.repos.map((repo) => (
            <View key={repo} style={[styles.chip, { marginRight: 0 }]}>
              <Text style={styles.chipText}>{repo.split("/").pop()}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.muted}>не определено</Text>
        )}
        <Button
          styles={styles}
          theme={theme}
          icon="Pencil"
          label="Изменить"
          disabled={mutation.isPending}
          onPress={() => {
            setDraft(work.manualRepos ?? work.repos);
            setPicking(true);
          }}
        />
        {work.manualRepos ? (
          <Button styles={styles} theme={theme} icon="Wand" label="Авто" disabled={mutation.isPending} onPress={() => mutation.mutate({ repos: null })} />
        ) : null}
      </View>
      {work.manualLink ? (
        <View style={[styles.headerRow, { flexWrap: "wrap" }]}>
          <Text style={styles.text}>Привязано к {work.manualLink}</Text>
          <Button styles={styles} theme={theme} icon="Unlink" label="Отвязать" disabled={mutation.isPending} onPress={() => mutation.mutate({ link: null })} />
        </View>
      ) : work.loose ? (
        <View style={[styles.headerRow, { flexWrap: "wrap" }]}>
          <TextInput
            accessibilityLabel="Привязать к PR или issue"
            placeholder="Привязать к PR/issue: ссылка или owner/repo#123"
            placeholderTextColor={theme.colors.foregroundMuted}
            value={linkText}
            onChangeText={setLinkText}
            onSubmitEditing={linkTo}
            autoCapitalize="none"
            style={[styles.input, { flex: 1, minWidth: 200 }]}
          />
          <Button styles={styles} theme={theme} icon="Link" label="Привязать" disabled={!linkText.trim() || mutation.isPending} onPress={linkTo} />
        </View>
      ) : null}
      {picking ? (
        <Picker
          field={{ key: "repos", label: "Репозитории воркспейса", options: repoOptions }}
          selected={draft}
          onChange={setDraft}
          onClose={() => {
            setPicking(false);
            mutation.mutate({ repos: draft.length ? draft : null });
          }}
          theme={theme}
          styles={styles}
        />
      ) : null}
    </View>
  );
}

function workspaceRole(work: WorkItem, workspaceId: string): string | null {
  if (work.tasks.some((task) => task.agent.workspaceId === workspaceId)) return "координатор";
  const workers = work.tasks.flatMap((task) => task.workers).filter((worker) => worker.workspaceId === workspaceId);
  if (workers.length) return `рабочая копия, субагентов: ${workers.length}`;
  return null;
}

function WorkspaceRow({
  workspace,
  running,
  role,
  canArchive,
  styles,
  theme,
  navigation,
}: {
  workspace: BoardWorkspace;
  running: boolean;
  role: string | null;
  canArchive: boolean;
  styles: Styles;
  theme: PluginTheme;
  navigation: Navigation | undefined;
}) {
  const paseo = usePaseo();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const archive = useMutation({
    mutationFn: () => paseo.workspaces.archive(workspace.id),
    onSuccess: () => toast.show("Воркспейс архивирован", { variant: "success" }),
    onError: (error) => toast.error((error as Error).message),
  });
  return (
    <View style={[styles.row, { flexWrap: "wrap", paddingHorizontal: 0 }]}>
      <Icon name={workspace.kind === "worktree" ? "GitBranch" : "Folder"} size={14} color={theme.colors.foregroundMuted} />
      <View style={{ flex: 1, minWidth: 160 }}>
        <Text style={styles.text} numberOfLines={1}>
          {workspace.title ?? workspace.name}
        </Text>
        <Text style={styles.muted} numberOfLines={1}>
          {[role, workspace.kind === "worktree" ? `worktree · ${workspace.branch ?? workspace.directory}` : workspace.directory]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>
      {navigation ? (
        <Button styles={styles} theme={theme} icon="PanelsTopLeft" label="Открыть" onPress={() => navigation.openWorkspace({ workspaceId: workspace.id })} />
      ) : null}
      {canArchive ? (
        <Button
          styles={styles}
          theme={theme}
          icon={confirm ? "AlertTriangle" : "Archive"}
          label={confirm ? "Точно?" : "Архивировать"}
          disabled={running || archive.isPending}
          onPress={() => (confirm ? archive.mutate() : setConfirm(true))}
        />
      ) : null}
    </View>
  );
}

export function WorkDetail({ item: work, theme, styles, now, showWorkers, actions, profiles, navigation, onStarted, onBack, repoOptions, allWork, onSelect, dismissedAt }: Props) {
  const dismiss = useDismissToggle(work, allWork);
  const isDismissed = Boolean(dismissedAt && work.updatedAt <= dismissedAt);
  const color = workStatusColor(theme, work.status);
  const item = useItem(work);
  const todo = useTodoToggle();
  const repoName = work.repo?.split("/").pop() ?? null;
  const running = work.tasks.some((task) => task.agent.status === "running");
  const startAction = (agentId: string | null) => {
    if (work.todo && work.repo && work.number !== null) todo.mutate({ item: { repo: work.repo, number: work.number }, on: false });
    onStarted(agentId);
  };

  return (
    <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
      <View style={styles.headerRow}>
        {onBack ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Назад к списку" onPress={onBack} style={styles.button}>
            <Icon name="ArrowLeft" size={14} color={theme.colors.foreground} />
          </Pressable>
        ) : null}
        <View style={[styles.badge, { borderWidth: 1, borderColor: color, flexShrink: 1 }]}>
          <Text style={{ color, fontSize: 12, fontWeight: "600" }} numberOfLines={1}>
            {work.statusText}
          </Text>
        </View>
        <View style={{ flex: 1 }} />
        <Text style={styles.muted}>изм. {formatAge(work.updatedAt, now)}</Text>
        <Button
          styles={styles}
          theme={theme}
          icon={isDismissed ? "Eye" : "EyeOff"}
          label={isDismissed ? "Вернуть на доску" : "Убрать с доски"}
          disabled={dismiss.isPending || work.tasks.some((task) => task.agent.status === "running")}
          onPress={() => dismiss.mutate(!isDismissed)}
        />
      </View>
      <Text style={styles.heading} selectable>
        {work.title}
      </Text>
      <View style={[styles.headerRow, { flexWrap: "wrap" }]}>
        {work.repo && work.number !== null ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Открыть ${work.repo}#${work.number} на GitHub`}
            onPress={() => void openExternalUrl(item?.url ?? work.url ?? `https://github.com/${work.repo}/issues/${work.number}`)}
            style={styles.headerRow}
          >
            <Icon name={work.kind === "pr" ? "GitPullRequest" : "CircleDot"} size={13} color={theme.colors.accent} />
            <Text style={[styles.muted, { color: theme.colors.accent }]}>
              {repoName} #{work.number}
            </Text>
          </Pressable>
        ) : null}
        {work.kind === "pr" && work.prReview ? (
          <PrBadge theme={theme} pr={work.prReview} />
        ) : null}
        {work.pr !== null && work.pr !== work.number && work.repo ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Открыть PR ${work.pr}`}
            onPress={() => void openExternalUrl(`https://github.com/${work.repo}/pull/${work.pr}`)}
            style={styles.headerRow}
          >
            <Icon name="GitPullRequest" size={13} color={theme.colors.accent} />
            <Text style={[styles.muted, { color: theme.colors.accent }]}>PR #{work.pr}</Text>
            {work.prReview ? <PrBadge theme={theme} pr={work.prReview} /> : null}
          </Pressable>
        ) : null}
        {work.author ? <Text style={styles.muted}>от {work.author}</Text> : null}
        <Text style={styles.muted}>отправлено {formatDate(work.sentAt)}</Text>
      </View>
      <LabelList labels={work.labels} colors={work.labelColors} fallback={theme.colors.foregroundMuted} />
      <TaskArchive work={work} styles={styles} theme={theme} />
      <NoteBox key={work.key} itemKey={work.key} styles={styles} theme={theme} />
      {work.repo && work.number !== null ? (
        <View style={{ gap: 8 }}>
          <View style={[styles.headerRow, { flexWrap: "wrap" }]}>
            <Button
              styles={styles}
              theme={theme}
              icon={work.todo ? "BookmarkMinus" : "BookmarkPlus"}
              label={work.todo ? "Убрать из TODO" : "В TODO"}
              disabled={todo.isPending}
              onPress={() => todo.mutate({ item: item ?? { repo: work.repo ?? "", number: work.number ?? 0 }, on: !work.todo })}
            />
          </View>
          {item && !running ? (
            <ActionButtons item={item} actions={actions} profiles={profiles} theme={theme} styles={styles} onStarted={startAction} />
          ) : null}
        </View>
      ) : null}
      {work.kind === "scratch" ? <IntakeCard
          work={work}
          allWork={allWork}
          deliverReady={actions.some((action) => action.id === DELIVER_ACTION_ID && profiles.has(action.profile))}
          styles={styles}
          theme={theme}
          onSelect={onSelect}
        /> : null}
      {work.kind !== "scratch" ? (
        <DeliverCard run={work.run} github={work.repo} prNumber={work.pr} styles={styles} theme={theme} />
      ) : null}
      <Belonging work={work} repoOptions={repoOptions} styles={styles} theme={theme} />
      {work.workspaces.length ? (
        <View style={{ gap: 2 }}>
          <Text style={styles.strong}>Воркспейсы ({work.workspaces.length})</Text>
          {work.workspaces.map((workspace) => (
            <WorkspaceRow
              key={workspace.id}
              workspace={workspace}
              running={work.tasks.some((task) =>
                [task.agent, ...task.workers].some((agent) => agent.workspaceId === workspace.id && agent.status === "running"),
              )}
              role={workspaceRole(work, workspace.id)}
              canArchive={liveAgentsIn(work, workspace.id) === 0}
              styles={styles}
              theme={theme}
              navigation={navigation}
            />
          ))}
        </View>
      ) : null}
      {work.tasks.length ? (
        <View style={{ gap: 14 }}>
          <Text style={styles.strong}>Агенты</Text>
          {work.tasks.map((task, index) => (
            <View key={task.agent.id} style={[styles.card, { gap: 10 }]}>
              <AgentSection
                task={task}
                theme={theme}
                styles={styles}
                now={now}
                showWorkers={showWorkers}
                navigation={navigation}
                heading={`${index === 0 ? "Координатор" : "Агент"}: ${task.workspace?.title ?? task.agent.title ?? task.agent.id}`}
              />
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.muted}>{work.workspaces.length ? "Живых агентов нет: они архивированы." : "Агентов по этой задаче нет."}</Text>
      )}
    </ScrollView>
  );
}
