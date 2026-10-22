import { useEffect } from "react";
import type { PluginTheme } from "@getpaseo/plugin";
import { Animated, Easing, View } from "react-native";
import type { WorkStatus } from "../shared/contracts";
import type { Tone } from "../shared/model";

const DOT_SIZE = 8;
const RING_DOT_SIZE = 6;
const RING_SIZE = RING_DOT_SIZE + 6;
const RING_FRAME_SIZE = RING_SIZE + 2;
const RING_STROKE = 1.5;
const RING_TRACK_OPACITY = 0.3;
const RING_HEAD_OPACITY = 0.9;
const RING_PERIOD_MS = 900;
const WAITING_PURPLE = "#8b5cf6";

const DARK = { running: "#5caaf6", success: "#35c264", warning: "#db932e", danger: "#f7796d" };
const LIGHT = { running: "#268ae0", success: "#299f51", warning: "#b37824", danger: "#f12e2f" };

export type MarkKind = "running" | "success" | "warning" | "danger" | "waiting" | "ready" | "done" | "muted";

function isDark(theme: PluginTheme): boolean {
  const match = /^#?([0-9a-f]{6})/i.exec(theme.colors.surface0);
  if (!match) return true;
  const value = parseInt(match[1], 16);
  const luminance = 0.299 * ((value >> 16) & 255) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255);
  return luminance < 128;
}

export function markColor(theme: PluginTheme, kind: MarkKind): string {
  const palette = isDark(theme) ? DARK : LIGHT;
  switch (kind) {
    case "running":
      return palette.running;
    case "success":
    case "ready":
      return palette.success;
    case "warning":
      return palette.warning;
    case "danger":
      return palette.danger;
    case "waiting":
      return WAITING_PURPLE;
    case "done":
      return theme.colors.border;
    default:
      return theme.colors.foregroundMuted;
  }
}

export function workMark(status: WorkStatus): MarkKind {
  switch (status) {
    case "attention":
      return "danger";
    case "question":
      return "warning";
    case "running":
      return "running";
    case "finished":
      return "success";
    case "waiting":
      return "waiting";
    case "ready":
      return "ready";
    case "closed":
      return "done";
    default:
      return "muted";
  }
}

export function toneMark(tone: Tone): MarkKind {
  switch (tone) {
    case "running":
      return "running";
    case "danger":
      return "danger";
    case "waiting":
      return "warning";
    case "done":
      return "success";
    default:
      return "done";
  }
}

const rotation = new Animated.Value(0);
let spinners = 0;
let loop: Animated.CompositeAnimation | null = null;

function useSharedSpin() {
  useEffect(() => {
    spinners += 1;
    if (!loop) {
      rotation.setValue(0);
      loop = Animated.loop(
        Animated.timing(rotation, { toValue: 1, duration: RING_PERIOD_MS, easing: Easing.linear, useNativeDriver: false }),
      );
      loop.start();
    }
    return () => {
      spinners -= 1;
      if (!spinners && loop) {
        loop.stop();
        loop = null;
      }
    };
  }, []);
}

const spin = rotation.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

function RunningRing({ color }: { color: string }) {
  useSharedSpin();
  const ring = { position: "absolute" as const, width: RING_SIZE, height: RING_SIZE, borderRadius: RING_SIZE / 2, borderWidth: RING_STROKE };
  return (
    <View style={{ width: RING_FRAME_SIZE, height: RING_FRAME_SIZE, alignItems: "center", justifyContent: "center" }}>
      <View style={[ring, { borderColor: color, opacity: RING_TRACK_OPACITY }]} />
      <Animated.View
        style={[ring, { borderColor: "transparent", borderTopColor: color, opacity: RING_HEAD_OPACITY, transform: [{ rotate: spin }] }]}
      />
      <View style={{ width: RING_DOT_SIZE, height: RING_DOT_SIZE, borderRadius: RING_DOT_SIZE / 2, backgroundColor: color }} />
    </View>
  );
}

export function StatusMark({ theme, kind }: { theme: PluginTheme; kind: MarkKind }) {
  const color = markColor(theme, kind);
  if (kind === "running") return <RunningRing color={color} />;
  const dot =
    kind === "ready"
      ? { borderWidth: RING_STROKE, borderColor: color }
      : { backgroundColor: color };
  return (
    <View style={{ width: RING_FRAME_SIZE, height: RING_FRAME_SIZE, alignItems: "center", justifyContent: "center" }}>
      <View style={[{ width: DOT_SIZE, height: DOT_SIZE, borderRadius: DOT_SIZE / 2 }, dot]} />
    </View>
  );
}
