import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef, useState } from "react";
import { addTodoRpc, removeTodoRpc, viewSettings, type Item } from "../shared/contracts";

type ViewValues = z.output<typeof viewSettings.schema>;

const DEFAULT_VIEW: ViewValues = {
  work: { repos: [], kinds: [], statuses: [], labels: [], authors: [], bases: [], text: "" },
  items: { repos: [], kinds: [], statuses: [], labels: [], authors: [], bases: [], text: "" },
  sort: { column: "updated", descending: true },
  itemsSort: { column: "updated", descending: true },
  noTaskOpen: false,
  showDismissed: false,
};

export function useView() {
  const settings = useSettings(viewSettings);
  const [view, setView] = useState<ViewValues>(DEFAULT_VIEW);
  const loaded = useRef(false);
  const latest = useRef(settings);
  latest.current = settings;

  useEffect(() => {
    if (!loaded.current && settings.status === "ready") {
      loaded.current = true;
      setView(settings.values);
    }
  }, [settings]);

  useEffect(() => {
    if (!loaded.current) return undefined;
    const timer = setTimeout(() => {
      const current = latest.current;
      if (current.status === "ready" && JSON.stringify(current.values) !== JSON.stringify(view)) {
        void current.save(view, current.revision);
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [view]);

  return [view, setView] as const;
}

export function useTodoToggle() {
  const add = useRpc(addTodoRpc);
  const remove = useRpc(removeTodoRpc);
  const client = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ item, on }: { item: Pick<Item, "repo" | "number"> & Partial<Item>; on: boolean }) =>
      on
        ? add({
            repo: item.repo,
            number: item.number,
            kind: item.kind ?? "issue",
            url: item.url ?? `https://github.com/${item.repo}/issues/${item.number}`,
            title: item.title ?? `${item.repo}#${item.number}`,
            author: item.author ?? null,
            updatedAt: item.updatedAt ?? null,
            isDraft: item.isDraft ?? false,
            labels: item.labels ?? [],
            state: item.state ?? "open",
            baseRef: item.baseRef ?? null,
          })
        : remove({ repo: item.repo, number: item.number }),
    onSuccess: (result) => client.setQueryData(["todos"], result),
    onError: (error) => toast.error((error as Error).message),
  });
}
