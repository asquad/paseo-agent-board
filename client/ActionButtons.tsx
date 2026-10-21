import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { actionApplies } from "../shared/actions";
import { runActionRpc, type BoardAction, type Item } from "../shared/contracts";
import type { Styles } from "./styles";

interface Props {
  item: Item;
  actions: readonly BoardAction[];
  profiles: ReadonlySet<string>;
  theme: PluginTheme;
  styles: Styles;
  onStarted(agentId: string | null): void;
  initialPending?: string;
}

export function ActionButtons({ item, actions, profiles, theme, styles, onStarted, initialPending }: Props) {
  const run = useRpc(runActionRpc);
  const toast = useToast();
  const [pending, setPending] = useState<BoardAction | null>(
    () => actions.find((action) => action.id === initialPending && action.askForInput) ?? null,
  );
  const [input, setInput] = useState("");
  const mutation = useMutation({
    mutationFn: ({ action, text }: { action: BoardAction; text: string }) => run({ actionId: action.id, item, input: text }),
    onSuccess: (result) => {
      toast.show(`Запущено: ${result.prompt}`, { variant: "success" });
      setPending(null);
      setInput("");
      onStarted(result.agentId);
    },
    onError: (error) => toast.error((error as Error).message),
  });
  const applicable = actions.filter((action) => actionApplies(action, item));
  if (!applicable.length) return null;

  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {applicable.map((action) => {
          const missing = !profiles.has(action.profile);
          const disabled = missing || mutation.isPending;
          return (
            <Pressable
              key={action.id}
              accessibilityRole="button"
              accessibilityLabel={missing ? `${action.label}: profile ${action.profile || "not set"} is missing` : `${action.label} ${item.repo}#${item.number}`}
              disabled={disabled}
              onPress={() => (action.askForInput ? setPending(pending?.id === action.id ? null : action) : mutation.mutate({ action, text: "" }))}
              style={[styles.primary, disabled ? { opacity: 0.5 } : null]}
            >
              <Icon name={action.icon || "Play"} size={14} color={theme.colors.accentForeground} />
              <Text style={styles.primaryText}>
                {mutation.isPending && mutation.variables?.action.id === action.id ? "Запуск…" : action.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {applicable.some((action) => !profiles.has(action.profile)) ? (
        <Text style={styles.muted}>Бледные кнопки требуют профиль, которого нет; поменяйте его в Settings → Agent board.</Text>
      ) : null}
      {pending ? (
        <View style={{ gap: 6 }}>
          <TextInput
            accessibilityLabel={`Instructions for ${pending.label}`}
            placeholder={`Инструкции для ${pending.label} (необязательно), например: target 9, no-post`}
            placeholderTextColor={theme.colors.foregroundMuted}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => mutation.mutate({ action: pending, text: input })}
            style={styles.input}
          />
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Start ${pending.label}`}
              disabled={mutation.isPending}
              onPress={() => mutation.mutate({ action: pending, text: input })}
              style={[styles.primary, mutation.isPending ? { opacity: 0.5 } : null]}
            >
              <Icon name="Play" size={14} color={theme.colors.accentForeground} />
              <Text style={styles.primaryText}>{mutation.isPending ? "Запуск…" : `Запустить ${pending.label}`}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={() => setPending(null)} style={styles.button}>
              <Text style={styles.buttonText}>Отмена</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}
