import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Text, View } from "react-native";
import type { PrReviewState } from "../shared/work";

const MERGED_PURPLE = "#8250df";

export function prBadge(theme: PluginTheme, pr: PrReviewState): { label: string; color: string; icon: string } {
  if (pr.state === "merged") return { label: "Смёржен", color: MERGED_PURPLE, icon: "GitMerge" };
  if (pr.state === "closed") return { label: "Закрыт", color: theme.colors.foregroundMuted, icon: "GitPullRequestClosed" };
  if (pr.isDraft) return { label: "Черновик", color: theme.colors.foregroundMuted, icon: "GitPullRequestDraft" };
  switch (pr.reviewDecision) {
    case "APPROVED":
      return { label: "Одобрен", color: theme.colors.statusSuccess, icon: "CircleCheck" };
    case "CHANGES_REQUESTED":
      return { label: "Нужны правки", color: theme.colors.statusDanger, icon: "FileDiff" };
    case "REVIEW_REQUIRED":
      return { label: "Ждёт ревью", color: theme.colors.statusWarning, icon: "Eye" };
    default:
      return { label: "Открыт", color: theme.colors.accent, icon: "GitPullRequest" };
  }
}

export function PrBadge({ theme, pr, prefix }: { theme: PluginTheme; pr: PrReviewState; prefix?: string }) {
  const { label, color, icon } = prBadge(theme, pr);
  return (
    <View
      accessibilityLabel={`${prefix ? `${prefix}: ` : ""}${label}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: color,
      }}
    >
      <Icon name={icon} size={11} color={color} />
      <Text style={{ fontSize: 11, color }} numberOfLines={1}>
        {prefix ? `${prefix} · ` : ""}
        {label}
      </Text>
    </View>
  );
}
