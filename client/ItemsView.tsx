import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { FlatList, Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  DEFAULT_PR_STATES,
  DELIVER_ACTION_ID,
  PR_STATES,
  itemKey,
  resolveItemRpc,
  searchItemsRpc,
  type BoardAction,
  type Filter,
  type Item,
  type Repo,
} from "../shared/contracts";
import { formatAge } from "../shared/model";
import type { WorkItem } from "../shared/work";
import { ActionButton, ActionButtons } from "./ActionButtons";
import { FilterBar, type FilterField } from "./FilterBar";
import { LabelList, labelColor } from "./LabelChip";
import { PrBadge } from "./PrBadge";
import { SortControl } from "./SortControl";
import { workStatusColor, type Styles } from "./styles";
import { useTodoToggle } from "./view";

interface Props {
  repos: readonly Repo[];
  work: readonly WorkItem[];
  actions: readonly BoardAction[];
  profiles: ReadonlySet<string>;
  filter: Filter;
  onFilterChange(filter: Filter): void;
  sort: { column: ItemsSortColumn; descending: boolean };
  onSortChange(sort: { column: ItemsSortColumn; descending: boolean }): void;
  theme: PluginTheme;
  styles: Styles;
  now: number;
  compact: boolean;
  onOpenWork(key: string): void;
  onStarted(agentId: string | null): void;
}

const COMMON_BASES = ["main", "master", "develop", "staging"];

type ItemsSortColumn = "updated" | "title" | "number";

function sortItems(items: readonly Item[], column: ItemsSortColumn, descending: boolean): Item[] {
  const compare = (a: Item, b: Item): number => {
    switch (column) {
      case "title":
        return a.title.localeCompare(b.title, "ru", { sensitivity: "base", numeric: true });
      case "number":
        return a.number - b.number || a.repo.localeCompare(b.repo);
      default:
        return (a.updatedAt ?? "").localeCompare(b.updatedAt ?? "");
    }
  };
  const sorted = [...items].sort(compare);
  return descending ? sorted.reverse() : sorted;
}

function useDebounced<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

type Expanded = { key: string } | null;

export function ItemsView({ repos, work, actions, profiles, filter, onFilterChange, sort, onSortChange, theme, styles, now, compact, onOpenWork, onStarted }: Props) {
  const search = useRpc(searchItemsRpc);
  const resolve = useRpc(resolveItemRpc);
  const todo = useTodoToggle();
  const [reference, setReference] = useState("");
  const [expanded, setExpanded] = useState<Expanded>(null);
  const query = useDebounced(
    {
      repos: filter.repos,
      kind: filter.kinds.length === 1 ? (filter.kinds[0] as "pr" | "issue") : ("all" as const),
      labels: filter.labels,
      author: filter.authors.length === 1 ? filter.authors[0] : null,
      bases: filter.bases ?? [],
      prStates: filter.prStates ?? DEFAULT_PR_STATES,
      query: filter.text,
    },
    500,
  );
  const items = useInfiniteQuery({
    queryKey: ["items", query],
    queryFn: ({ pageParam }) => search({ ...query, cursors: pageParam }),
    initialPageParam: null as Record<string, string | null> | null,
    getNextPageParam: (last) => (Object.values(last.cursors).some(Boolean) ? last.cursors : undefined),
    placeholderData: (previous) => previous,
  });
  const loaded = useMemo(() => {
    const seen = new Set<string>();
    return (items.data?.pages ?? [])
      .flatMap((page) => page.items)
      .filter((item) => {
        const key = itemKey(item.repo, item.number);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [items.data]);
  const total = items.data?.pages[0]?.total ?? 0;
  const loadMore = () => {
    if (items.hasNextPage && !items.isFetchingNextPage) void items.fetchNextPage();
  };
  const resolved = useQuery({
    queryKey: ["resolve", reference.trim(), filter.repos[0] ?? null],
    queryFn: () => resolve({ reference: reference.trim(), defaultRepo: filter.repos[0] ?? null }),
    enabled: reference.trim().length > 0,
    retry: false,
  });

  const workByKey = useMemo(() => {
    const map = new Map<string, WorkItem>();
    for (const item of work) {
      if (!item.repo) continue;
      if (item.number !== null) map.set(itemKey(item.repo, item.number), item);
      if (item.pr !== null) map.set(itemKey(item.repo, item.pr), item);
    }
    return map;
  }, [work]);

  const list = useMemo(
    () =>
      sortItems(
        loaded.filter((item) => filter.authors.length < 2 || (item.author && filter.authors.includes(item.author))),
        sort.column,
        sort.descending,
      ),
    [loaded, filter.authors, sort],
  );

  const fields: FilterField[] = useMemo(() => {
    const labels = new Set(filter.labels);
    const colors: Record<string, string> = {};
    const authors = new Set(filter.authors);
    for (const item of loaded) {
      item.labels.forEach((label) => labels.add(label));
      Object.assign(colors, item.labelColors);
      if (item.author) authors.add(item.author);
    }
    return [
      {
        key: "repos",
        label: "Репо",
        options: repos.flatMap((repo) => (repo.github && !repo.archived ? [{ value: repo.github, label: repo.name }] : [])),
      },
      {
        key: "kinds",
        label: "Тип",
        options: [
          { value: "pr", label: "PR" },
          { value: "issue", label: "Issue" },
        ],
      },
      { key: "labels", label: "Метки", options: [...labels].sort().map((label) => ({ value: label, label, color: labelColor(colors, label) })) },
      { key: "authors", label: "Автор", options: [...authors].sort().map((author) => ({ value: author, label: author })) },
      {
        key: "prStates",
        label: "Статус PR",
        defaults: DEFAULT_PR_STATES,
        options: PR_STATES.map((state) => ({ value: state.value, label: state.label })),
      },
      {
        key: "bases",
        label: "Ветка PR",
        allowCustom: true,
        options: [...new Set([...COMMON_BASES, ...work.flatMap((item) => (item.baseRef ? [item.baseRef] : [])), ...filter.bases])]
          .sort()
          .map((base) => ({ value: base, label: base })),
      },
    ];
  }, [repos, loaded, filter.labels, filter.authors, filter.bases, work]);

  const deliver = actions.find((action) => action.id === DELIVER_ACTION_ID) ?? null;
  const others = actions.filter((action) => action.id !== DELIVER_ACTION_ID);

  function renderItem(item: Item, pinned = false) {
    const key = itemKey(item.repo, item.number);
    const inWork = workByKey.get(key) ?? null;
    const open = expanded?.key === key ? expanded : null;
    return (
      <View key={key} style={[{ borderRadius: 6 }, open || pinned ? styles.rowSelected : null]}>
        <View style={[styles.row, { flexWrap: compact ? "wrap" : "nowrap" }]}>
          <Icon
            name={item.kind === "pr" ? "GitPullRequest" : "CircleDot"}
            size={15}
            color={item.isDraft || item.labels.includes("draft") ? theme.colors.foregroundMuted : item.kind === "pr" ? theme.colors.accent : theme.colors.statusSuccess}
          />
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Открыть ${item.repo}#${item.number} на GitHub`}
            onPress={() => void openExternalUrl(item.url)}
            style={{ flex: 1, minWidth: 160, gap: 2 }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={[styles.text, { flexShrink: 1 }]} numberOfLines={1}>
                {item.title}
              </Text>
              {item.kind === "pr" ? (
                <PrBadge theme={theme} pr={{ state: item.state, isDraft: item.isDraft, reviewDecision: item.reviewDecision }} />
              ) : null}
            </View>
            <Text style={styles.muted} numberOfLines={1}>
              {item.repo.split("/").pop()} #{item.number}
              {item.author ? ` · ${item.author}` : ""}
              {item.updatedAt ? ` · ${formatAge(item.updatedAt, now)}` : ""}
            </Text>
            <LabelList labels={item.labels} colors={item.labelColors} fallback={theme.colors.foregroundMuted} limit={4} />
          </Pressable>
          {inWork ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Уже в работе: ${inWork.statusText}`}
              onPress={() => onOpenWork(inWork.key)}
              style={styles.button}
            >
              <View style={[styles.dot, { backgroundColor: workStatusColor(theme, inWork.status) }]} />
              <Text style={styles.buttonText} numberOfLines={1}>
                {inWork.todo && !inWork.tasks.length ? "TODO" : "В работе"}
              </Text>
            </Pressable>
          ) : (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Добавить ${item.repo}#${item.number} в TODO`}
                disabled={todo.isPending}
                onPress={() => todo.mutate({ item, on: true })}
                style={styles.button}
              >
                <Icon name="BookmarkPlus" size={14} color={theme.colors.foreground} />
                <Text style={styles.buttonText}>TODO</Text>
              </Pressable>
              {deliver ? (
                <ActionButton
                  item={item}
                  action={deliver}
                  label="DELIVER"
                  profiles={profiles}
                  theme={theme}
                  styles={styles}
                  onStarted={onStarted}
                />
              ) : null}
            </>
          )}
          {others.length ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Другие действия"
              onPress={() => setExpanded(open ? null : { key })}
              style={styles.button}
            >
              <Icon name="Ellipsis" size={14} color={theme.colors.foreground} />
            </Pressable>
          ) : null}
        </View>
        {open ? (
          <View style={{ paddingHorizontal: 10, paddingBottom: 10 }}>
            <ActionButtons
              item={item}
              actions={others}
              profiles={profiles}
              theme={theme}
              styles={styles}
              onStarted={(agentId) => {
                setExpanded(null);
                onStarted(agentId);
              }}
            />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, gap: 8 }}>
      <FilterBar
        filter={filter}
        fields={fields}
        onChange={onFilterChange}
        theme={theme}
        styles={styles}
        placeholder="Поиск по открытым PR и issues"
      />
      <SortControl
        options={[
          { id: "updated", label: "Изменено" },
          { id: "title", label: "Название" },
          { id: "number", label: "№ issue/PR" },
        ]}
        column={sort.column}
        descending={sort.descending}
        onChange={onSortChange}
        theme={theme}
        styles={styles}
      />
      <TextInput
        accessibilityLabel="Ссылка на PR или issue"
        placeholder="Или вставьте ссылку на PR/issue, owner/repo#123"
        placeholderTextColor={theme.colors.foregroundMuted}
        value={reference}
        onChangeText={setReference}
        autoCapitalize="none"
        style={styles.input}
      />
      {reference.trim() ? (
        resolved.data ? (
          renderItem(resolved.data, true)
        ) : (
          <Text style={resolved.error ? styles.error : styles.muted}>
            {resolved.error ? (resolved.error as Error).message : "Ищу…"}
          </Text>
        )
      ) : null}
      {items.error ? <Text style={styles.error}>{(items.error as Error).message}</Text> : null}
      <FlatList
        data={list}
        keyExtractor={(item) => itemKey(item.repo, item.number)}
        renderItem={({ item }) => renderItem(item)}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          loaded.length ? (
            <View style={[styles.row, { justifyContent: "center", gap: 10 }]}>
              <Text style={styles.muted}>
                Показано {list.length} из {total}
                {items.isFetching && !items.isFetchingNextPage ? " · обновляю…" : ""}
              </Text>
              {items.hasNextPage ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Показать ещё"
                  disabled={items.isFetchingNextPage}
                  onPress={loadMore}
                  style={[styles.button, items.isFetchingNextPage ? { opacity: 0.5 } : null]}
                >
                  <Text style={styles.buttonText}>{items.isFetchingNextPage ? "Загружаю…" : "Показать ещё"}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null
        }
        ListEmptyComponent={
          <Text style={[styles.muted, { padding: 12 }]}>
            {items.isPending ? "Загружаю открытые PR и issues…" : "Ничего не найдено."}
          </Text>
        }
      />
    </View>
  );
}
