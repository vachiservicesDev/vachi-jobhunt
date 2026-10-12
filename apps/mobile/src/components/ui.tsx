import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, useColorScheme, type TextInputProps, type ViewStyle } from "react-native";

const palette = {
  light: { bg: "#FFFFFF", surface: "#F4F6F8", text: "#111418", muted: "#5B6470", border: "#DCE1E6", primary: "#2457F5", onPrimary: "#FFFFFF", good: "#137A3A", warn: "#9A5B00", danger: "#B42318" },
  dark: { bg: "#0E1116", surface: "#191D24", text: "#ECEFF3", muted: "#9AA4B2", border: "#2A303A", primary: "#6E8EFF", onPrimary: "#0E1116", good: "#4CC27A", warn: "#E0A44A", danger: "#F07167" },
};
export type Palette = typeof palette.light;
export const useColors = (): Palette => palette[useColorScheme() === "dark" ? "dark" : "light"];

export function Screen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const c = useColors();
  return <View style={[{ flex: 1, backgroundColor: c.bg, padding: 20, gap: 16 }, style]}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  const c = useColors();
  return <Text style={{ fontSize: 26, fontWeight: "700", color: c.text }}>{children}</Text>;
}

export function Body({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: object }) {
  const c = useColors();
  return <Text style={[{ fontSize: 16, lineHeight: 22, color: muted ? c.muted : c.text }, style]}>{children}</Text>;
}

export function Button({ label, onPress, loading, disabled, variant = "primary" }: {
  label: string; onPress: () => void; loading?: boolean; disabled?: boolean; variant?: "primary" | "secondary" | "danger";
}) {
  const c = useColors();
  const bg = variant === "primary" ? c.primary : variant === "danger" ? c.danger : c.surface;
  const fg = variant === "secondary" ? c.text : c.onPrimary;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontSize: 16, fontWeight: "600" }}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.muted, fontSize: 14 }}>{label}</Text>
      <TextInput
        placeholderTextColor={c.muted}
        {...props}
        style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.surface }]}
      />
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, { borderColor: selected ? c.primary : c.border, backgroundColor: selected ? c.primary : "transparent" }]}
    >
      <Text style={{ color: selected ? c.onPrimary : c.text, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  const c = useColors();
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return <Text style={{ color: c.danger }}>{msg}</Text>;
}

export function ScoreBadge({ score }: { score: number }) {
  const c = useColors();
  const color = score >= 75 ? c.good : score >= 55 ? c.primary : c.warn;
  return (
    <View style={[styles.badge, { borderColor: color }]} accessibilityLabel={`Match score ${score}`}>
      <Text style={{ color, fontWeight: "700" }}>{score}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 50, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  badge: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, alignItems: "center", justifyContent: "center" },
});
