import type { PluginTheme } from "@getpaseo/plugin";
import { FlatList, Icon } from "@getpaseo/plugin/client/react-native";
import { Pressable, Text, View } from "react-native";
import { formatAge } from "../shared/model";
import { formatWorkNumbers, type SortColumn, type WorkItem } from "../shared/work";
import { workStatusColor, type Styles } from "./styles";

interface Props {
  items: readonly WorkItem[];
  loose: readonly WorkItem[];
  childrenOf: ReadonlyMap<string, readonly WorkItem[]>;
  notes: ReadonlyMap<string, string>;
  sort: { column: SortColumn; descending: boolean };
  onSort(column: SortColumn): void;
  selected: string | null;
  onSelect(key: string): void;
  looseOpen: boolean;
  onToggleLoose(): void;
  theme: PluginTheme;
  styles: Styles;
  now: number;
  compact: boolean;
  loading: boolean;
}

function shortDate(iso: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function repoNames(item: WorkItem): string {
  return item.repos.map((repo) => repo.split("/").pop() ?? repo).join(", ");
}

const COLUMNS: { id: SortColumn; label: string; width?: number }[] = [
  { id: "status", label: "", width: 22 },
  { id: "title", label: "Название" },
  { id: "number", label: "№", width: 150 },
  { id: "sent", label: "Отправлено", width: 96 },
  { id: "updated", label: "Изменено", width: 72 },
];

function Row({
  item,
  selected,
  onSelect,
  theme,
  styles,
  now,
  compact,
  depth = 0,
  note,
}: {
  item: WorkItem;
  note?: string;
  depth?: number;
  selected: boolean;
  onSelect(key: string): void;
  theme: PluginTheme;
  styles: Styles;
  now: number;
  compact: boolean;
}) {
  const color = workStatusColor(theme, item.status);
  const multiRepo = item.repos.length > 1;
  const reference =
    item.repo && item.number !== null && !multiRepo
      ? `${item.repo.split("/").pop()} #${item.number}`
      : item.repo && item.number !== null
        ? `${repoNames(item)}${compact ? ` · ${formatWorkNumbers(item)}` : ""}`
        : item.kind === "scratch"
        ? `scratch${item.repos.length ? ` · ${repoNames(item)}` : ""}${compact && item.childItems.length ? ` · ${formatWorkNumbers(item)}` : ""}`
        : repoNames(item) || "репо не определено";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${item.statusText}`}
      onPress={() => onSelect(item.key)}
      style={[styles.row, depth ? { paddingLeft: 10 + depth * 22 } : null, selected ? styles.rowSelected : null]}
    >
      {depth ? <Icon name="CornerDownRight" size={13} color={theme.colors.foregroundMuted} /> : null}
      <View style={{ width: 22, alignItems: "center" }}>
        <View style={[styles.dot, { backgroundColor: color, width: 10, height: 10, borderRadius: 5 }]} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          {item.pinned ? <Icon name="Pin" size={11} color={theme.colors.foregroundMuted} /> : null}
          <Text style={[styles.text, { flex: 1 }, item.status === "closed" ? { color: theme.colors.foregroundMuted } : null]} numberOfLines={1}>
            {item.title}
          </Text>
          {note ? <Icon name="StickyNote" size={12} color={theme.colors.statusWarning} /> : null}
        </View>
        {note ? (
          <Text style={[styles.muted, { fontStyle: "italic" }]} numberOfLines={1}>
            {note.split("\n")[0]}
          </Text>
        ) : null}
        <Text style={styles.muted} numberOfLines={1}>
          {reference} · {item.statusText}
          {compact ? ` · отпр. ${shortDate(item.sentAt)} · изм. ${formatAge(item.updatedAt, now)}` : ""}
        </Text>
      </View>
      {compact ? null : (
        <>
          <Text style={[styles.muted, { width: 150 }]} numberOfLines={1}>
            {formatWorkNumbers(item)}
          </Text>
          <Text style={[styles.muted, { width: 96 }]}>{shortDate(item.sentAt)}</Text>
          <Text style={[styles.muted, { width: 72 }]}>{item.updatedAt ? formatAge(item.updatedAt, now) : "—"}</Text>
        </>
      )}
    </Pressable>
  );
}

export function WorkTable({ items, loose, childrenOf, notes, sort, onSort, selected, onSelect, looseOpen, onToggleLoose, theme, styles, now, compact, loading }: Props) {
  const header = compact ? null : (
    <View style={[styles.row, { paddingVertical: 4 }]}>
      {COLUMNS.map((column) => (
        <Pressable
          key={column.id}
          accessibilityRole="button"
          accessibilityLabel={`Сортировать: ${column.label || "статус"}`}
          onPress={() => onSort(column.id)}
          style={[{ flexDirection: "row", alignItems: "center", gap: 2 }, column.width ? { width: column.width } : { flex: 1 }]}
        >
          {column.id === "status" ? (
            <Icon name="CircleDot" size={12} color={theme.colors.foregroundMuted} />
          ) : (
            <Text style={[styles.muted, sort.column === column.id ? { color: theme.colors.foreground } : null]}>{column.label}</Text>
          )}
          {sort.column === column.id ? <Icon name={sort.descending ? "ChevronDown" : "ChevronUp"} size={12} color={theme.colors.foreground} /> : null}
        </Pressable>
      ))}
    </View>
  );

  const footer = loose.length ? (
    <View style={{ marginTop: 8, gap: 2 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Без задачи" onPress={onToggleLoose} style={styles.row}>
        <Icon name={looseOpen ? "ChevronDown" : "ChevronRight"} size={14} color={theme.colors.foregroundMuted} />
        <Text style={[styles.strong, { flex: 1 }]}>Без задачи ({loose.length})</Text>
      </Pressable>
      {looseOpen
        ? loose.map((item) => (
            <Row key={item.key} item={item} selected={selected === item.key} onSelect={onSelect} theme={theme} styles={styles} now={now} compact={compact} />
          ))
        : null}
    </View>
  ) : null;

  return (
    <FlatList
      data={items as WorkItem[]}
      keyExtractor={(item) => item.key}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      ListEmptyComponent={<Text style={[styles.muted, { padding: 12 }]}>{loading ? "Загружаю…" : "Под фильтр ничего не попало."}</Text>}
      renderItem={({ item }) => (
        <View>
          <Row item={item} note={notes.get(item.key)} selected={selected === item.key} onSelect={onSelect} theme={theme} styles={styles} now={now} compact={compact} />
          {(childrenOf.get(item.key) ?? []).map((child) => (
            <Row
              key={child.key}
              item={child}
              note={notes.get(child.key)}
              depth={1}
              selected={selected === child.key}
              onSelect={onSelect}
              theme={theme}
              styles={styles}
              now={now}
              compact={compact}
            />
          ))}
        </View>
      )}
    />
  );
}
