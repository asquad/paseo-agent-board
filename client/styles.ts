import type { PluginTheme } from "@getpaseo/plugin";
import type { WorkStatus } from "../shared/contracts";
import type { Tone } from "../shared/model";
import { markColor, toneMark, workMark } from "./StatusMark";

export function toneColor(theme: PluginTheme, tone: Tone): string {
  return markColor(theme, toneMark(tone));
}

export function makeStyles(theme: PluginTheme, compact: boolean) {
  const { colors } = theme;
  return {
    screen: { flex: 1, backgroundColor: colors.surface0, padding: compact ? 12 : 16, gap: 10 },
    headerRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
    title: { color: colors.foreground, fontSize: compact ? 18 : 20, fontWeight: "600" as const, flex: 1 },
    muted: { color: colors.foregroundMuted, fontSize: 12 },
    text: { color: colors.foreground, fontSize: 13, lineHeight: 19 },
    strong: { color: colors.foreground, fontSize: 13, fontWeight: "600" as const },
    heading: { color: colors.foreground, fontSize: compact ? 16 : 17, fontWeight: "600" as const, lineHeight: 22 },
    button: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
    },
    buttonText: { color: colors.foreground, fontSize: 12 },
    primary: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 6,
      backgroundColor: colors.accent,
    },
    primaryText: { color: colors.accentForeground, fontSize: 12, fontWeight: "600" as const },
    tabs: {
      flexDirection: "row" as const,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
      padding: 3,
      gap: 3,
    },
    tab: { flex: 1, alignItems: "center" as const, paddingVertical: 7, borderRadius: 6 },
    tabActive: { backgroundColor: colors.surface2 },
    tabText: { color: colors.foregroundMuted, fontSize: 13 },
    tabTextActive: { color: colors.foreground, fontSize: 13, fontWeight: "600" as const },
    chip: {
      paddingHorizontal: 9,
      paddingVertical: 4,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      marginRight: 6,
    },
    chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.foregroundMuted, fontSize: 12 },
    chipTextActive: { color: colors.accentForeground, fontSize: 12 },
    input: {
      color: colors.foreground,
      backgroundColor: colors.surface1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 6,
      paddingHorizontal: 10,
      paddingVertical: 7,
      fontSize: 13,
    },
    row: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 6,
    },
    rowSelected: { backgroundColor: colors.surface2 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    card: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      backgroundColor: colors.surface1,
      padding: 10,
      gap: 6,
    },
    badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5, alignSelf: "flex-start" as const },
    divider: { height: 1, backgroundColor: colors.border },
    error: { color: colors.statusDanger, fontSize: 12 },
  };
}

export type Styles = ReturnType<typeof makeStyles>;

export function workStatusColor(theme: PluginTheme, status: WorkStatus): string {
  return markColor(theme, workMark(status));
}
