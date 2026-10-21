import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Pressable, Text, View } from "react-native";
import type { Styles } from "./styles";

export interface SortOption<Column extends string> {
  id: Column;
  label: string;
}

interface Props<Column extends string> {
  options: readonly SortOption<Column>[];
  column: Column;
  descending: boolean;
  onChange(sort: { column: Column; descending: boolean }): void;
  theme: PluginTheme;
  styles: Styles;
}

export function SortControl<Column extends string>({ options, column, descending, onChange, theme, styles }: Props<Column>) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
      <Text style={styles.muted}>Сортировка:</Text>
      {options.map((option) => {
        const active = option.id === column;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Сортировать: ${option.label}`}
            onPress={() => onChange({ column: option.id, descending: active ? descending : option.id !== "title" })}
            style={[styles.chip, { marginRight: 0 }, active ? styles.chipActive : null]}
          >
            <Text style={active ? styles.chipTextActive : styles.chipText}>{option.label}</Text>
          </Pressable>
        );
      })}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={descending ? "По убыванию; переключить на возрастание" : "По возрастанию; переключить на убывание"}
        onPress={() => onChange({ column, descending: !descending })}
        style={[styles.button, { paddingVertical: 4 }]}
      >
        <Icon name={descending ? "ArrowDownWideNarrow" : "ArrowUpNarrowWide"} size={14} color={theme.colors.foreground} />
        <Text style={styles.buttonText}>{descending ? "убыв." : "возр."}</Text>
      </Pressable>
    </View>
  );
}
