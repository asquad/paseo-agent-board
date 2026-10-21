import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text } from "react-native";
import { launchIntakeRpc } from "../shared/contracts";
import type { Styles } from "./styles";

interface Props {
  open: boolean;
  onOpenChange(open: boolean): void;
  theme: PluginTheme;
  styles: Styles;
  onLaunched(agentId: string | null): void;
}

export function ScratchDialog({ open, onOpenChange, theme, styles, onLaunched }: Props) {
  const launch = useRpc(launchIntakeRpc);
  const toast = useToast();
  const [description, setDescription] = useState("");
  const mutation = useMutation({
    mutationFn: () => launch({ description: description.trim() }),
    onSuccess: (result) => {
      toast.show("Scratch запущен", { variant: "success" });
      setDescription("");
      onOpenChange(false);
      onLaunched(result.agentId);
    },
    onError: (error) => toast.error((error as Error).message),
  });
  const ready = description.trim().length > 0 && !mutation.isPending;
  return (
    <Modal title="Deliver from scratch" open={open} onOpenChange={onOpenChange}>
      <Modal.Content>
        <Text style={styles.muted}>
          Опишите задачу своими словами. Координатор из корня экосистемы разберёт её по репозиториям и опубликует
          issues с меткой draft. Дальше всё на доске: проверите issues, подтвердите нужные (там же можно задать
          параметры deliver), и по каждой запустится /deliver.
        </Text>
        <TextInput
          accessibilityLabel="Описание задачи"
          placeholder="Что нужно сделать, зачем, какие компоненты затронуты…"
          placeholderTextColor={theme.colors.foregroundMuted}
          multiline
          autoFocus
          value={description}
          onChangeText={setDescription}
          style={[styles.input, { minHeight: 220, textAlignVertical: "top" }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Запустить scratch"
          disabled={!ready}
          onPress={() => mutation.mutate()}
          style={[styles.primary, { alignSelf: "flex-start" }, ready ? null : { opacity: 0.5 }]}
        >
          <Icon name="Sparkles" size={14} color={theme.colors.accentForeground} />
          <Text style={styles.primaryText}>{mutation.isPending ? "Запуск…" : "Разобрать в issues"}</Text>
        </Pressable>
      </Modal.Content>
    </Modal>
  );
}
