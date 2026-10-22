import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, usePaseo, useRpc } from "@getpaseo/plugin/client";
import { copyText, Icon, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { prStatusRpc, resolveItemRpc, startCleanupRpc, type BoardAction, type RunState } from "../shared/contracts";
import { formatAge, type BoardAgent, type Task } from "../shared/model";
import { ActionButtons } from "./ActionButtons";
import { useCleanupJobs, useLatestReport } from "./data";
import { toneColor, type Styles } from "./styles";
import { StatusMark, toneMark, type MarkKind } from "./StatusMark";

export interface Navigation {
  openAgent(input: { agentId: string }): void;
  openWorkspace(input: { workspaceId: string }): void;
}

export function Button({
  styles,
  theme,
  icon,
  label,
  onPress,
  disabled,
}: {
  styles: Styles;
  theme: PluginTheme;
  icon: string;
  label: string;
  onPress(): void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled ? { opacity: 0.5 } : null]}
    >
      <Icon name={icon} size={14} color={theme.colors.foreground} />
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function Line({ styles, label, value }: { styles: Styles; label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <Text style={styles.text}>
      <Text style={styles.strong}>{label}: </Text>
      {value}
    </Text>
  );
}

export function DeliverCard({
  run,
  github,
  prNumber,
  styles,
  theme,
}: {
  run: RunState | null;
  github: string | null;
  prNumber: number | null;
  styles: Styles;
  theme: PluginTheme;
}) {
  const readPr = useRpc(prStatusRpc);
  const [checked, setChecked] = useState(false);
  const pr = useQuery({
    queryKey: ["pr", github, prNumber],
    queryFn: () => readPr({ repo: github ?? "", number: prNumber ?? 0 }),
    enabled: checked && Boolean(github) && Boolean(prNumber),
    staleTime: 60_000,
  });
  if (!run && !(github && prNumber)) return null;
  const attention = run?.needsUser ?? run?.blocker;
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Icon name="GitPullRequest" size={14} color={theme.colors.foregroundMuted} />
        <Text style={[styles.strong, { flex: 1 }]}>
          {run ? `Deliver${run.round !== null ? ` · R${run.round}` : ""}${run.stage ? ` · ${run.stage}` : ""}` : "Pull request"}
        </Text>
        {run?.score !== null && run?.score !== undefined ? (
          <Text style={styles.strong}>
            {run.score}/10{run.scoreTarget ? ` (цель ${run.scoreTarget})` : ""}
          </Text>
        ) : null}
      </View>
      {attention ? <Text style={[styles.text, { color: theme.colors.statusWarning }]}>{attention}</Text> : null}
      <Line styles={styles} label="Сделано" value={run?.lastCompleted} />
      <Line styles={styles} label="Дальше" value={run?.next} />
      <Line styles={styles} label="Итог" value={run?.state === "final" ? run.result : null} />
      {pr.data ? (
        <View style={{ gap: 2 }}>
          <Text style={styles.text}>
            {pr.data.state}
            {pr.data.isDraft ? " · draft" : ""}
            {pr.data.reviewDecision ? ` · ${pr.data.reviewDecision.toLowerCase().replace(/_/g, " ")}` : " · без решения ревью"}
            {pr.data.mergeable ? ` · ${pr.data.mergeable.toLowerCase()}` : ""}
          </Text>
          <Text style={styles.text}>
            Проверки: {pr.data.checks.passed} прошли, {pr.data.checks.failed} упали, {pr.data.checks.pending} ждут
          </Text>
          {pr.data.checks.failedNames.length ? (
            <Text style={styles.error} numberOfLines={2}>
              Упали: {pr.data.checks.failedNames.join(", ")}
            </Text>
          ) : null}
          {pr.data.deliver ? (
            <Text style={styles.muted}>
              Статусный комментарий: {pr.data.deliver.state}
              {pr.data.deliver.score !== null ? `, оценка ${pr.data.deliver.score}/10` : ""}
            </Text>
          ) : null}
        </View>
      ) : null}
      {pr.error ? <Text style={styles.error}>{(pr.error as Error).message}</Text> : null}
      <View style={[styles.headerRow, { flexWrap: "wrap" }]}>
        {github && prNumber ? (
          <Button
            styles={styles}
            theme={theme}
            icon="RefreshCw"
            label={pr.isFetching ? "Проверяю…" : checked ? "Перепроверить PR" : "Проверить PR"}
            disabled={pr.isFetching}
            onPress={() => (checked ? void pr.refetch() : setChecked(true))}
          />
        ) : null}
        {run?.statusCommentUrl ? (
          <Button
            styles={styles}
            theme={theme}
            icon="MessageSquare"
            label="Статусный комментарий"
            onPress={() => void openExternalUrl(run.statusCommentUrl ?? "")}
          />
        ) : null}
      </View>
    </View>
  );
}

function Composer({ agent, styles, theme }: { agent: BoardAgent; styles: Styles; theme: PluginTheme }) {
  const paseo = usePaseo();
  const toast = useToast();
  const [text, setText] = useState("");
  const running = agent.status === "running";
  const send = useMutation({
    mutationFn: (message: string) =>
      paseo.agents.ref(agent.id).send(message, running ? { activeTurnBehavior: "steer" } : undefined),
    onSuccess: () => {
      setText("");
      toast.show(running ? "Добавлено в текущий ход" : "Промпт отправлен", { variant: "success" });
    },
    onError: (error) => toast.error((error as Error).message),
  });
  return (
    <View style={{ gap: 6 }}>
      <TextInput
        accessibilityLabel="Сообщение агенту"
        placeholder={running ? "Подсказка для текущего хода" : "Промпт агенту, например: continue"}
        placeholderTextColor={theme.colors.foregroundMuted}
        multiline
        value={text}
        onChangeText={setText}
        style={[styles.input, { minHeight: 56, textAlignVertical: "top" }]}
      />
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={running ? "Подсказать текущему ходу" : "Отправить промпт"}
          disabled={!text.trim() || send.isPending}
          onPress={() => send.mutate(text.trim())}
          style={[styles.primary, !text.trim() || send.isPending ? { opacity: 0.5 } : null]}
        >
          <Icon name="Send" size={14} color={theme.colors.accentForeground} />
          <Text style={styles.primaryText}>{running ? "Подсказать" : "Отправить"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Report({ agent, styles, theme, now }: { agent: BoardAgent; styles: Styles; theme: PluginTheme; now: number }) {
  const report = useLatestReport(agent.id, agent.updatedAt);
  const [expanded, setExpanded] = useState(false);
  if (report.isPending) return <Text style={styles.muted}>Загружаю последний отчёт…</Text>;
  if (report.error) return <Text style={styles.error}>{(report.error as Error).message}</Text>;
  if (!report.data) return <Text style={styles.muted}>Отчёта пока нет.</Text>;
  return (
    <View style={{ gap: 4 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? "Свернуть отчёт" : "Развернуть отчёт"}
        onPress={() => setExpanded((value) => !value)}
        style={styles.headerRow}
      >
        <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={14} color={theme.colors.foregroundMuted} />
        <Text style={[styles.strong, { flex: 1 }]}>Последний отчёт</Text>
        <Text style={styles.muted}>{formatAge(report.data.timestamp, now)}</Text>
      </Pressable>
      <Text style={styles.text} numberOfLines={expanded ? undefined : 10} selectable>
        {report.data.text}
      </Text>
    </View>
  );
}

function workerMark(worker: BoardAgent): MarkKind {
  if (worker.pendingPermissions > 0 || worker.attentionReason === "permission") return "warning";
  if (worker.status === "error" || worker.attentionReason === "error") return "danger";
  if (worker.status === "running" || worker.status === "initializing") return "running";
  if (worker.requiresAttention) return "success";
  return "done";
}

export function AgentSection({
  task,
  theme,
  styles,
  now,
  showWorkers,
  navigation,
  heading,
  showArchive = false,
}: {
  task: Task;
  theme: PluginTheme;
  styles: Styles;
  now: number;
  showWorkers: boolean;
  navigation: Navigation | undefined;
  heading?: string;
  showArchive?: boolean;
}) {
  const toast = useToast();
  const client = useQueryClient();
  const startCleanup = useRpc(startCleanupRpc);
  const jobs = useCleanupJobs();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const archive = useMutation({
    mutationFn: (skipCleanup: boolean) => startCleanup({ agentId: task.agent.id, skipCleanup }),
    onSuccess: (result) => {
      setConfirmArchive(false);
      toast.show(result.job.message, { variant: "success" });
      void client.invalidateQueries({ queryKey: ["cleanup-jobs"] });
    },
    onError: (error) => toast.error((error as Error).message),
  });
  const { agent } = task;
  const job = jobs.find((candidate) => candidate.agentId === agent.id) ?? null;
  const jobActive = job?.state === "cleaning" || job?.state === "archiving";
  return (
    <View style={{ gap: 10 }}>
      {heading ? (
        <View style={styles.headerRow}>
          <StatusMark theme={theme} kind={toneMark(task.tone)} />
          <Text style={[styles.strong, { flex: 1 }]} numberOfLines={1}>
            {heading}
          </Text>
          <Text style={styles.muted}>
            {task.statusText} · {formatAge(agent.updatedAt, now)}
          </Text>
        </View>
      ) : null}
      <View style={[styles.headerRow, { flexWrap: "wrap" }]}>
        <Text style={styles.muted}>
          {agent.provider}
          {agent.model ? ` · ${agent.model}` : ""}
        </Text>
        {task.workspace?.branch ? (
          <View style={styles.headerRow}>
            <Icon name="GitBranch" size={12} color={theme.colors.accent} />
            <Text style={[styles.muted, { color: theme.colors.accent }]} selectable>
              {task.workspace.branch}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={[styles.headerRow, { flexWrap: "wrap" }]}>
        {navigation ? (
          <Button styles={styles} theme={theme} icon="Bot" label="Открыть агента" onPress={() => navigation.openAgent({ agentId: agent.id })} />
        ) : null}
        {navigation && agent.workspaceId ? (
          <Button
            styles={styles}
            theme={theme}
            icon="PanelsTopLeft"
            label="Воркспейс"
            onPress={() => navigation.openWorkspace({ workspaceId: agent.workspaceId ?? "" })}
          />
        ) : null}
        {showArchive ? (
          <>
        <Button
          styles={styles}
          theme={theme}
          icon={confirmArchive ? "AlertTriangle" : "Archive"}
          label={confirmArchive ? "Cleanup и архив?" : "Архивировать"}
          disabled={archive.isPending || jobActive || agent.status === "running"}
          onPress={() => (confirmArchive ? archive.mutate(false) : setConfirmArchive(true))}
        />
        {job?.state === "failed" || job?.state === "needs-you" ? (
          <Button
            styles={styles}
            theme={theme}
            icon="ArchiveX"
            label="Архивировать без cleanup"
            disabled={archive.isPending}
            onPress={() => archive.mutate(true)}
          />
        ) : null}
          </>
        ) : null}
      </View>
      {job ? (
        <Text style={job.state === "failed" ? styles.error : [styles.muted, job.state === "needs-you" ? { color: theme.colors.statusWarning } : null]}>
          {job.message}
        </Text>
      ) : null}
      {agent.lastError ? (
        <Text style={styles.error} selectable>
          {agent.lastError}
        </Text>
      ) : null}
      <Composer agent={agent} styles={styles} theme={theme} />
      {showWorkers && task.workers.length ? (
        <View style={{ gap: 2 }}>
          <Text style={styles.strong}>Субагенты ({task.workers.length})</Text>
          {task.workers.map((worker) => (
            <Pressable
              key={worker.id}
              accessibilityRole="button"
              accessibilityLabel={`Открыть субагента ${worker.title ?? worker.id}`}
              disabled={!navigation}
              onPress={() => navigation?.openAgent({ agentId: worker.id })}
              style={styles.row}
            >
              <StatusMark theme={theme} kind={workerMark(worker)} />
              <Text style={[styles.text, { flex: 1 }]} numberOfLines={1}>
                {worker.title ?? worker.id}
              </Text>
              <Text style={styles.muted}>
                {worker.provider}
                {worker.model ? ` · ${worker.model}` : ""}
              </Text>
              <Text style={styles.muted}>{formatAge(worker.updatedAt, now)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={styles.divider} />
      <Report agent={agent} styles={styles} theme={theme} now={now} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Скопировать рабочую папку"
        onPress={() =>
          void copyText(agent.cwd).then(
            () => toast.show("Путь скопирован"),
            () => toast.error("Не удалось скопировать путь"),
          )
        }
        style={styles.headerRow}
      >
        <Icon name="Folder" size={14} color={theme.colors.foregroundMuted} />
        <Text style={[styles.muted, { flex: 1 }]} numberOfLines={1}>
          {agent.cwd}
        </Text>
        <Icon name="Copy" size={14} color={theme.colors.foregroundMuted} />
      </Pressable>
    </View>
  );
}

interface TaskDetailProps {
  task: Task;
  theme: PluginTheme;
  styles: Styles;
  now: number;
  showWorkers: boolean;
  actions: readonly BoardAction[];
  profiles: ReadonlySet<string>;
  onStarted(agentId: string | null): void;
  navigation: Navigation | undefined;
  onBack?: () => void;
}

function TaskActions({ task, actions, profiles, theme, styles, onStarted }: Pick<TaskDetailProps, "task" | "actions" | "profiles" | "theme" | "styles" | "onStarted">) {
  const resolve = useRpc(resolveItemRpc);
  const github = task.repo?.github ?? null;
  const reference = github && task.number !== null ? `${github}#${task.number}` : null;
  const item = useQuery({
    queryKey: ["resolve", reference, null],
    queryFn: () => resolve({ reference: reference ?? "", defaultRepo: null }),
    enabled: Boolean(reference) && actions.length > 0,
    staleTime: 10 * 60_000,
    retry: false,
  });
  if (!item.data) return null;
  return <ActionButtons item={item.data} actions={actions} profiles={profiles} theme={theme} styles={styles} onStarted={onStarted} />;
}

export function TaskDetail({ task, theme, styles, now, showWorkers, actions, profiles, onStarted, navigation, onBack }: TaskDetailProps) {
  const color = toneColor(theme, task.tone);
  return (
    <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 24 }}>
      <View style={styles.headerRow}>
        {onBack ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Назад к списку" onPress={onBack} style={styles.button}>
            <Icon name="ArrowLeft" size={14} color={theme.colors.foreground} />
          </Pressable>
        ) : null}
        <View style={[styles.badge, { borderWidth: 1, borderColor: color }]}>
          <Text style={{ color, fontSize: 12, fontWeight: "600" }}>{task.statusText}</Text>
        </View>
        <View style={{ flex: 1 }} />
        <Text style={styles.muted}>{formatAge(task.agent.updatedAt, now)}</Text>
      </View>
      <Text style={styles.heading} selectable>
        {task.workspace?.title ?? task.label}
      </Text>
      <TaskActions task={task} actions={actions} profiles={profiles} theme={theme} styles={styles} onStarted={onStarted} />
      <AgentSection task={task} theme={theme} styles={styles} now={now} showWorkers={showWorkers} navigation={navigation} showArchive />
    </ScrollView>
  );
}
