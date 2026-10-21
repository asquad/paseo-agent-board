import { Text, View } from "react-native";

function readableText(hex: string): string {
  const value = /^[0-9a-f]{6}$/i.test(hex) ? hex : "888888";
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  const lightness = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lightness > 0.55 ? "#1f2328" : "#ffffff";
}

export function labelColor(colors: Readonly<Record<string, string>>, name: string): string | undefined {
  const hex = colors[name];
  return hex ? `#${hex}` : undefined;
}

export function LabelChip({ name, color, fallback }: { name: string; color: string | undefined; fallback: string }) {
  const hex = color?.replace("#", "");
  return (
    <View
      style={{
        paddingHorizontal: 7,
        paddingVertical: 1,
        borderRadius: 10,
        backgroundColor: hex ? `#${hex}` : "transparent",
        borderWidth: hex ? 0 : 1,
        borderColor: fallback,
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: "500", color: hex ? readableText(hex) : fallback }} numberOfLines={1}>
        {name}
      </Text>
    </View>
  );
}

export function LabelList({
  labels,
  colors,
  fallback,
  limit,
}: {
  labels: readonly string[];
  colors: Readonly<Record<string, string>>;
  fallback: string;
  limit?: number;
}) {
  if (!labels.length) return null;
  const shown = limit ? labels.slice(0, limit) : labels;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
      {shown.map((label) => (
        <LabelChip key={label} name={label} color={labelColor(colors, label)} fallback={fallback} />
      ))}
      {labels.length > shown.length ? <Text style={{ fontSize: 11, color: fallback }}>+{labels.length - shown.length}</Text> : null}
    </View>
  );
}
