import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { launchIntakeRpc, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_TOTAL_BYTES } from "../shared/contracts";
import type { Styles } from "./styles";
import { filePickingSupported, listenForFiles, pickFiles, type PickedFile } from "./web";

interface Props {
  open: boolean;
  onOpenChange(open: boolean): void;
  theme: PluginTheme;
  styles: Styles;
  onLaunched(agentId: string | null): void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export function ScratchDialog({ open, onOpenChange, theme, styles, onLaunched }: Props) {
  const launch = useRpc(launchIntakeRpc);
  const toast = useToast();
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<PickedFile[]>([]);

  const addFiles = (incoming: Promise<PickedFile[]>) => {
    incoming.then(
      (picked) =>
        setFiles((current) => {
          const next = [...current];
          for (const file of picked) {
            if (file.size > MAX_ATTACHMENT_BYTES) {
              toast.error(`${file.name}: больше ${formatSize(MAX_ATTACHMENT_BYTES)}`);
              continue;
            }
            const total = next.reduce((sum, item) => sum + item.size, 0) + file.size;
            if (total > MAX_ATTACHMENTS_TOTAL_BYTES) {
              toast.error(`Вложения больше ${formatSize(MAX_ATTACHMENTS_TOTAL_BYTES)} вместе`);
              break;
            }
            next.push(file);
          }
          return next;
        }),
      (error: unknown) => toast.error((error as Error).message),
    );
  };

  useEffect(() => (open ? listenForFiles(addFiles) : undefined), [open]);

  const mutation = useMutation({
    mutationFn: () =>
      launch({
        description: description.trim(),
        attachments: files.map((file) => ({ name: file.name, mimeType: file.mimeType, data: file.data })),
      }),
    onSuccess: (result) => {
      toast.show("Scratch запущен", { variant: "success" });
      setDescription("");
      setFiles([]);
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
          placeholder={
            filePickingSupported
              ? "Что нужно сделать, зачем, какие компоненты затронуты… Картинки и файлы можно вставить через Ctrl+V или перетащить сюда."
              : "Что нужно сделать, зачем, какие компоненты затронуты…"
          }
          placeholderTextColor={theme.colors.foregroundMuted}
          multiline
          autoFocus
          value={description}
          onChangeText={setDescription}
          style={[styles.input, { minHeight: 200, textAlignVertical: "top" }]}
        />
        {files.length ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {files.map((file, index) => (
              <View key={`${file.name}-${index}`} style={[styles.card, { flexDirection: "row", alignItems: "center", gap: 8, padding: 6 }]}>
                {file.mimeType.startsWith("image/") ? (
                  <Image
                    source={{ uri: `data:${file.mimeType};base64,${file.data}` }}
                    style={{ width: 56, height: 56, borderRadius: 4 }}
                    resizeMode="cover"
                    accessibilityLabel={file.name}
                  />
                ) : (
                  <Icon name="FileText" size={22} color={theme.colors.foregroundMuted} />
                )}
                <View style={{ maxWidth: 180 }}>
                  <Text style={styles.text} numberOfLines={1}>
                    {file.name}
                  </Text>
                  <Text style={styles.muted}>{formatSize(file.size)}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Убрать ${file.name}`}
                  onPress={() => setFiles((current) => current.filter((_, position) => position !== index))}
                  style={{ padding: 4 }}
                >
                  <Icon name="X" size={14} color={theme.colors.foregroundMuted} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Запустить scratch"
            disabled={!ready}
            onPress={() => mutation.mutate()}
            style={[styles.primary, ready ? null : { opacity: 0.5 }]}
          >
            <Icon name="Sparkles" size={14} color={theme.colors.accentForeground} />
            <Text style={styles.primaryText}>{mutation.isPending ? "Запуск…" : "Разобрать в issues"}</Text>
          </Pressable>
          {filePickingSupported ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Прикрепить файлы"
              disabled={mutation.isPending}
              onPress={() => addFiles(pickFiles())}
              style={styles.button}
            >
              <Icon name="Paperclip" size={14} color={theme.colors.foreground} />
              <Text style={styles.buttonText}>Прикрепить файлы</Text>
            </Pressable>
          ) : null}
          {files.length ? (
            <Text style={styles.muted}>
              {files.length} влож. · {formatSize(files.reduce((sum, file) => sum + file.size, 0))}
            </Text>
          ) : null}
        </View>
      </Modal.Content>
    </Modal>
  );
}
