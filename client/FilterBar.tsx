import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal, ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Filter } from "../shared/contracts";
import type { Styles } from "./styles";

export interface FilterOption {
  value: string;
  label: string;
  color?: string;
}

export interface FilterField {
  key: "repos" | "kinds" | "statuses" | "labels" | "authors" | "bases";
  allowCustom?: boolean;
  label: string;
  options: readonly FilterOption[];
}

interface Props {
  filter: Filter;
  fields: readonly FilterField[];
  onChange(filter: Filter): void;
  theme: PluginTheme;
  styles: Styles;
  placeholder: string;
}

export function Picker({
  field,
  selected,
  onChange,
  onClose,
  theme,
  styles,
}: {
  field: FilterField;
  selected: readonly string[];
  onChange(values: string[]): void;
  onClose(): void;
  theme: PluginTheme;
  styles: Styles;
}) {
  const [search, setSearch] = useState("");
  const extra = selected.filter((value) => !field.options.some((option) => option.value === value)).map((value): FilterOption => ({ value, label: value }));
  const options: FilterOption[] = [...field.options, ...extra].filter((option) => option.label.toLowerCase().includes(search.toLowerCase()));
  const custom = field.allowCustom && search.trim() && !options.some((option) => option.value === search.trim()) ? search.trim() : null;
  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((current) => current !== value) : [...selected, value]);
  return (
    <Modal title={field.label} open onOpenChange={(open) => (open ? undefined : onClose())}>
      <Modal.Content scrollable={false} style={{ flex: 1 }} contentContainerStyle={{ flex: 1, padding: 16, gap: 10 }}>
        {field.options.length > 8 || field.allowCustom ? (
          <TextInput
            accessibilityLabel={`Поиск: ${field.label}`}
            placeholder={field.allowCustom ? "Поиск или своё значение" : "Поиск"}
            placeholderTextColor={theme.colors.foregroundMuted}
            value={search}
            onChangeText={setSearch}
            style={styles.input}
          />
        ) : null}
        <ScrollView style={{ flex: 1, minHeight: 120 }} contentContainerStyle={{ gap: 2 }}>
          {custom ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Добавить ${custom}`}
              onPress={() => {
                onChange([...selected, custom]);
                setSearch("");
              }}
              style={styles.row}
            >
              <Icon name="Plus" size={16} color={theme.colors.accent} />
              <Text style={[styles.text, { flex: 1 }]}>Добавить «{custom}»</Text>
            </Pressable>
          ) : null}
          {options.length || custom ? null : <Text style={styles.muted}>Нет вариантов.</Text>}
          {options.map((option) => {
            const checked = selected.includes(option.value);
            return (
              <Pressable
                key={option.value}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                accessibilityLabel={option.label}
                onPress={() => toggle(option.value)}
                style={styles.row}
              >
                <Icon name={checked ? "SquareCheck" : "Square"} size={16} color={checked ? theme.colors.accent : theme.colors.foregroundMuted} />
                {option.color ? <View style={[styles.dot, { backgroundColor: option.color }]} /> : null}
                <Text style={[styles.text, { flex: 1 }]} numberOfLines={1}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Сбросить" onPress={() => onChange([])} style={styles.button}>
            <Text style={styles.buttonText}>Сбросить</Text>
          </Pressable>
          <View style={{ flex: 1 }} />
          <Pressable accessibilityRole="button" accessibilityLabel="Готово" onPress={onClose} style={styles.primary}>
            <Text style={styles.primaryText}>Готово</Text>
          </Pressable>
        </View>
      </Modal.Content>
    </Modal>
  );
}

export function FilterBar({ filter, fields, onChange, theme, styles, placeholder }: Props) {
  const [open, setOpen] = useState<FilterField["key"] | null>(null);
  const openField = fields.find((field) => field.key === open) ?? null;
  const active = fields.some((field) => filter[field.key].length) || filter.text.length > 0;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        {fields.map((field) => {
          const selected = filter[field.key];
          const summary =
            selected.length === 0
              ? field.label
              : selected.length === 1
                ? `${field.label}: ${field.options.find((option) => option.value === selected[0])?.label ?? selected[0]}`
                : `${field.label}: ${selected.length}`;
          return (
            <Pressable
              key={field.key}
              accessibilityRole="button"
              accessibilityLabel={`Фильтр ${field.label}`}
              onPress={() => setOpen(field.key)}
              style={[styles.chip, { flexDirection: "row", alignItems: "center", gap: 4 }, selected.length ? styles.chipActive : null]}
            >
              <Text style={selected.length ? styles.chipTextActive : styles.chipText} numberOfLines={1}>
                {summary}
              </Text>
              <Icon name="ChevronDown" size={12} color={selected.length ? theme.colors.accentForeground : theme.colors.foregroundMuted} />
            </Pressable>
          );
        })}
        {active ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Сбросить все фильтры"
            onPress={() => onChange({ repos: [], kinds: [], statuses: [], labels: [], authors: [], bases: [], text: "" })}
            style={styles.chip}
          >
            <Text style={styles.chipText}>Сбросить</Text>
          </Pressable>
        ) : null}
      </View>
      <TextInput
        accessibilityLabel="Поиск"
        placeholder={placeholder}
        placeholderTextColor={theme.colors.foregroundMuted}
        value={filter.text}
        onChangeText={(text) => onChange({ ...filter, text })}
        style={styles.input}
      />
      {openField ? (
        <Picker
          field={openField}
          selected={filter[openField.key]}
          onChange={(values) => onChange({ ...filter, [openField.key]: values })}
          onClose={() => setOpen(null)}
          theme={theme}
          styles={styles}
        />
      ) : null}
    </View>
  );
}
