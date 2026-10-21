import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { BoardScreen } from "./client/BoardScreen";
import { SettingsScreen } from "./client/SettingsScreen";

const SCREEN = "board";

function BoardItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="LayoutList"
      active={currentScreen?.screenId === SCREEN}
      onPress={() => openScreen({ screenId: SCREEN })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: SCREEN, title: "Agent board", Component: BoardScreen });
  client.addSidebarHeaderItem({ id: SCREEN, title: "Agent board", Component: BoardItem });
  client.addSettingsScreen({ id: "settings", title: "Agent board", icon: "LayoutList", Component: SettingsScreen });
  client.addCommandCenterItem({
    id: "open-board",
    title: "Agent board: в работе",
    icon: "LayoutList",
    keywords: ["agents", "board", "work", "todo"],
    context: "global",
    onSelect: ({ openScreen }) => openScreen({ screenId: SCREEN, params: { view: "work" } }),
  });
  client.addCommandCenterItem({
    id: "open-items",
    title: "Agent board: PR и issues",
    icon: "GitPullRequest",
    keywords: ["deliver", "pull request", "issue", "todo"],
    context: "global",
    onSelect: ({ openScreen }) => openScreen({ screenId: SCREEN, params: { view: "items" } }),
  });
  client.addCommandCenterItem({
    id: "deliver-from-scratch",
    title: "Deliver from scratch",
    icon: "Sparkles",
    keywords: ["scratch", "new task", "issue", "deliver"],
    context: "global",
    onSelect: ({ openScreen }) => openScreen({ screenId: SCREEN, params: { scratch: "1" } }),
  });
  client.addCommandCenterItem({
    id: "show-agent",
    title: "Показать агента на Agent board",
    icon: "LayoutList",
    context: "agent",
    onSelect: ({ agent, openScreen }) => openScreen({ screenId: SCREEN, params: { agent: agent.parentAgentId ?? agent.id } }),
  });
  return () => {};
}
