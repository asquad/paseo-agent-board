import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { actionApplies } from "../shared/actions";
import { runActionRpc, type BoardAction, type Item } from "../shared/contracts";
import type { Styles } from "./styles";

interface ActionButtonProps {
  item: Item;
  action: BoardAction;
  profiles: ReadonlySet<string>;
  theme: PluginTheme;
  styles: Styles;
  onStarted(agentId: string | null): void;
  label?: string;
}

export function ActionButton({ item, action, profiles, theme, styles, onStarted, label }: ActionButtonProps) {
  const run = useRpc(runActionRpc);
  const toast = useToast();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [input, setInput] = useState("");
  const mutation = useMutation({
    mutationFn: (text: string) => run({ actionId: action.id, item, input: text }),
    onSuccess: (result) => {
      toast.show(`Запущено: ${result.prompt}`, { variant: "success" });
      setOptionsOpen(false);
      setInput("");
      onStarted(result.agentId);
    },
    onError: (error) => toast.error((error as Error).message),
  });
  const missing = !profiles.has(action.profile);
  const disabled = missing || mutation.isPending;
  const title = label ?? action.label;
  const accessibility = missing ? `${title}: профиль ${action.profile || "не задан"} не найден` : `${title} ${item.repo}#${item.number}`;

  return (
    <View style={{ flexDirection: "row" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibility}
        disabled={disabled}
        onPress={() => mutation.mutate("")}
        style={[
          styles.primary,
          action.askForInput ? { borderTopRightRadius: 0, borderBottomRightRadius: 0 } : null,
          disabled ? { opacity: 0.5 } : null,
        ]}
      >
        <Icon name={action.icon || "Play"} size={14} color={theme.colors.accentForeground} />
        <Text style={styles.primaryText}>{mutation.isPending ? "Запуск…" : title}</Text>
      </Pressable>
      {action.askForInput ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title}: параметры запуска`}
          disabled={disabled}
          onPress={() => setOptionsOpen(true)}
          style={[
            styles.primary,
            {
              borderTopLeftRadius: 0,
              borderBottomLeftRadius: 0,
              paddingHorizontal: 8,
              borderLeftWidth: 1,
              borderLeftColor: theme.colors.accentForeground,
            },
            disabled ? { opacity: 0.5 } : null,
          ]}
        >
          <Icon name="Settings" size={14} color={theme.colors.accentForeground} />
        </Pressable>
      ) : null}
      {optionsOpen ? (
        <Modal title={`${action.label}: ${item.repo.split("/").pop()} #${item.number}`} open onOpenChange={setOptionsOpen}>
          <Modal.Content>
            <Text style={styles.muted}>
              Недефолтные параметры запуска; без них кнопка запускает с настройками по умолчанию.
            </Text>
            <TextInput
              accessibilityLabel={`Параметры для ${action.label}`}
              placeholder="Например: target 9, no-post, base staging"
              placeholderTextColor={theme.colors.foregroundMuted}
              autoFocus
              value={input}
              onChangeText={setInput}
              onSubmitEditing={() => mutation.mutate(input.trim())}
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Запустить ${action.label} с параметрами`}
              disabled={mutation.isPending}
              onPress={() => mutation.mutate(input.trim())}
              style={[styles.primary, { alignSelf: "flex-start" }, mutation.isPending ? { opacity: 0.5 } : null]}
            >
              <Icon name={action.icon || "Play"} size={14} color={theme.colors.accentForeground} />
              <Text style={styles.primaryText}>{mutation.isPending ? "Запуск…" : `${action.label}`}</Text>
            </Pressable>
          </Modal.Content>
        </Modal>
      ) : null}
    </View>
  );
}

interface Props {
  item: Item;
  actions: readonly BoardAction[];
  profiles: ReadonlySet<string>;
  theme: PluginTheme;
  styles: Styles;
  onStarted(agentId: string | null): void;
}

export function ActionButtons({ item, actions, profiles, theme, styles, onStarted }: Props) {
  const applicable = actions.filter((action) => actionApplies(action, item));
  if (!applicable.length) return null;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {applicable.map((action) => (
          <ActionButton key={action.id} item={item} action={action} profiles={profiles} theme={theme} styles={styles} onStarted={onStarted} />
        ))}
      </View>
      {applicable.some((action) => !profiles.has(action.profile)) ? (
        <Text style={styles.muted}>Бледные кнопки требуют профиль, которого нет; поменяйте его в Settings → Agent board.</Text>
      ) : null}
    </View>
  );
}
