import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { STATUSES, type WorkStatus } from "../shared/contracts";
import { filterWork, sortWork, STATUS_LABELS, type SortColumn, type WorkItem } from "../shared/work";
import { useBoard, useNotes } from "./data";
import { FilterBar, type FilterField } from "./FilterBar";
import { ItemsView } from "./ItemsView";
import { ScratchDialog } from "./ScratchDialog";
import { SortControl } from "./SortControl";
import { labelColor } from "./LabelChip";
import { makeStyles, workStatusColor } from "./styles";
import { useView } from "./view";
import { WorkDetail } from "./WorkDetail";
import { WorkTable } from "./WorkTable";

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

const COMMON_BASES = ["main", "master", "develop", "staging"];

const KIND_LABELS: Record<string, string> = { pr: "PR", issue: "Issue", scratch: "Scratch", workspace: "Без задачи" };

export function BoardScreen({ theme, layout, params, navigation }: PluginScreenProps) {
  const styles = useMemo(() => makeStyles(theme, layout.compact), [theme, layout.compact]);
  const board = useBoard();
  const notes = useNotes();
  const now = useNow(30_000);
  const [view, setView] = useView();
  const [tab, setTab] = useState<"work" | "items">(params.view === "items" ? "items" : "work");
  const [selected, setSelected] = useState<string | null>(params.select ?? null);
  const [pendingAgent, setPendingAgent] = useState<string | null>(params.agent ?? null);
  const [scratchOpen, setScratchOpen] = useState(params.scratch === "1");

  useEffect(() => {
    if (params.view === "items") setTab("items");
    if (params.view === "work") setTab("work");
    if (params.agent) setPendingAgent(params.agent);
    if (params.select) setSelected(params.select);
    if (params.scratch === "1") setScratchOpen(true);
  }, [params.view, params.agent, params.select, params.scratch]);

  useEffect(() => {
    if (!pendingAgent) return;
    const item = board.work.find((candidate) =>
      candidate.tasks.some((task) => task.agent.id === pendingAgent || task.workers.some((worker) => worker.id === pendingAgent)),
    );
    if (item) {
      setTab("work");
      setSelected(item.key);
      setPendingAgent(null);
    }
  }, [pendingAgent, board.work]);

  const visible = useMemo(
    () => sortWork(filterWork(board.work, view.work, notes), view.sort.column, view.sort.descending),
    [board.work, view.work, view.sort, notes],
  );

  const grouped = useMemo(() => {
    const keys = new Set(visible.map((item) => item.key));
    const childrenOf = new Map<string, WorkItem[]>();
    for (const item of visible) {
      if (!item.parentKey || !keys.has(item.parentKey)) continue;
      childrenOf.set(item.parentKey, [...(childrenOf.get(item.parentKey) ?? []), item]);
    }
    const top = visible.filter((item) => !(item.parentKey && keys.has(item.parentKey)));
    return { childrenOf, items: top.filter((item) => !item.loose), loose: top.filter((item) => item.loose) };
  }, [visible]);

  const workFields: FilterField[] = useMemo(() => {
    const repos = new Map<string, string>();
    for (const repo of board.repos) if (repo.github) repos.set(repo.github, repo.name);
    const labels = new Set<string>(view.work.labels);
    const colors: Record<string, string> = {};
    const authors = new Set<string>(view.work.authors);
    const bases = new Set<string>([...COMMON_BASES, ...view.work.bases]);
    for (const item of board.work) {
      for (const repo of item.repos) if (!repos.has(repo)) repos.set(repo, repo.split("/").pop() ?? repo);
      item.labels.forEach((label) => labels.add(label));
      Object.assign(colors, item.labelColors);
      if (item.author) authors.add(item.author);
      if (item.baseRef) bases.add(item.baseRef);
    }
    return [
      { key: "repos", label: "Репо", options: [...repos].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label })) },
      { key: "kinds", label: "Тип", options: ["pr", "issue", "scratch", "workspace"].map((value) => ({ value, label: KIND_LABELS[value] })) },
      {
        key: "statuses",
        label: "Статус",
        options: STATUSES.map((status: WorkStatus) => ({ value: status, label: STATUS_LABELS[status], color: workStatusColor(theme, status) })),
      },
      { key: "labels", label: "Метки", options: [...labels].sort().map((label) => ({ value: label, label, color: labelColor(colors, label) })) },
      { key: "authors", label: "Автор", options: [...authors].sort().map((author) => ({ value: author, label: author })) },
      { key: "bases", label: "Ветка PR", allowCustom: true, options: [...bases].sort().map((base) => ({ value: base, label: base })) },
    ];
  }, [board.repos, board.work, view.work.labels, view.work.authors, view.work.bases, theme]);

  const selectedWork: WorkItem | null = board.work.find((item) => item.key === selected) ?? null;
  const fallback = layout.compact ? null : (visible.find((item) => !item.loose) ?? null);
  const detailWork = selectedWork ?? fallback;

  const showStarted = (agentId: string | null) => {
    setTab("work");
    if (agentId) setPendingAgent(agentId);
  };

  const onSort = (column: SortColumn) =>
    setView((current) => ({
      ...current,
      sort: {
        column,
        descending: current.sort.column === column ? !current.sort.descending : column !== "status" && column !== "title",
      },
    }));

  const back = layout.compact ? () => setSelected(null) : undefined;
  const detail = detailWork ? (
    <WorkDetail
      key={detailWork.key}
      item={detailWork}
      theme={theme}
      styles={styles}
      now={now}
      showWorkers={board.showWorkers}
      actions={board.actions}
      profiles={board.profiles}
      navigation={navigation}
      onStarted={showStarted}
      onBack={back}
      repoOptions={workFields[0]?.options ?? []}
      allWork={board.work}
      onSelect={setSelected}
    />
  ) : (
    <Text style={styles.muted}>Выберите задачу.</Text>
  );

  const table = (
    <View style={{ flex: 1, gap: 8 }}>
      <FilterBar
        filter={view.work}
        fields={workFields}
        onChange={(work) => setView((current) => ({ ...current, work }))}
        theme={theme}
        styles={styles}
        placeholder="Поиск по названию, номеру, статусу, комментарию"
      />
      <SortControl
        options={[
          { id: "updated", label: "Изменено" },
          { id: "title", label: "Название" },
          { id: "number", label: "№ issue/PR" },
          { id: "sent", label: "Отправлено" },
          { id: "status", label: "Статус" },
        ]}
        column={view.sort.column}
        descending={view.sort.descending}
        onChange={(sort) => setView((current) => ({ ...current, sort }))}
        theme={theme}
        styles={styles}
      />
      <WorkTable
        items={grouped.items}
        loose={grouped.loose}
        childrenOf={grouped.childrenOf}
        notes={notes}
        sort={view.sort}
        onSort={onSort}
        selected={detailWork?.key ?? selected}
        onSelect={setSelected}
        looseOpen={view.noTaskOpen}
        onToggleLoose={() => setView((current) => ({ ...current, noTaskOpen: !current.noTaskOpen }))}
        theme={theme}
        styles={styles}
        now={now}
        compact={layout.compact}
        loading={board.loading}
      />
    </View>
  );

  const intakeAvailable = board.deliverEnabled && board.profiles.has(board.intakeProfile);
  const activeCount = board.work.filter((item) => item.status !== "closed").length;

  return (
    <View style={styles.screen}>
      <View style={styles.headerRow}>
        <Text style={styles.title} numberOfLines={1}>
          {board.rootName || "Agent board"}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Обновить" onPress={board.refresh} style={styles.button}>
          <Icon name="RefreshCw" size={14} color={theme.colors.foreground} />
        </Pressable>
        {intakeAvailable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Deliver from scratch"
            onPress={() => setScratchOpen(true)}
            style={styles.primary}
          >
            <Icon name="Sparkles" size={14} color={theme.colors.accentForeground} />
            <Text style={styles.primaryText}>DELIVER FROM SCRATCH</Text>
          </Pressable>
        ) : null}
      </View>
      {board.errors.map((error) => (
        <Text key={error} style={styles.error} numberOfLines={2}>
          {error}
        </Text>
      ))}
      <View style={styles.tabs}>
        {(
          [
            { id: "work", label: `В работе ${activeCount}` },
            { id: "items", label: "PR и issues" },
          ] as const
        ).map(({ id, label }) => (
          <Pressable
            key={id}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === id }}
            accessibilityLabel={label}
            onPress={() => setTab(id)}
            style={[styles.tab, tab === id ? styles.tabActive : null]}
          >
            <Text style={tab === id ? styles.tabTextActive : styles.tabText}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {tab === "items" ? (
        <ItemsView
          repos={board.repos}
          work={board.work}
          actions={board.actions}
          profiles={board.profiles}
          filter={view.items}
          onFilterChange={(items) => setView((current) => ({ ...current, items }))}
          sort={view.itemsSort}
          onSortChange={(itemsSort) => setView((current) => ({ ...current, itemsSort }))}
          theme={theme}
          styles={styles}
          now={now}
          compact={layout.compact}
          onOpenWork={(key) => {
            setSelected(key);
            setTab("work");
          }}
          onStarted={showStarted}
        />
      ) : layout.compact ? (
        <View style={{ flex: 1 }}>{selectedWork ? detail : table}</View>
      ) : (
        <View style={{ flex: 1, flexDirection: "row", gap: 16 }}>
          <View style={{ width: "50%", minWidth: 380 }}>{table}</View>
          <View style={{ width: 1, backgroundColor: theme.colors.border }} />
          <View style={{ flex: 1 }}>{detail}</View>
        </View>
      )}
      <ScratchDialog open={scratchOpen} onOpenChange={setScratchOpen} theme={theme} styles={styles} onLaunched={showStarted} />
    </View>
  );
}
