import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

export const C = {
  paper: '#f7f1e6',
  card: '#fffdf8',
  ink: '#2b2420',
  muted: '#7a6e64',
  line: '#e4d9c8',
  accent: '#c2553a',   // terracotta
  accentSoft: '#f4dcd2',
  good: '#3c8a5a',
  warn: '#b7791f',
};
export const TITLE = { fontSize: 22, fontWeight: '800' as const, color: C.ink, letterSpacing: -0.3 };

type Kind = 'solid' | 'outline' | 'quiet';
export function Button({ title, onPress, kind = 'solid', disabled, busy, style }: {
  title: string; onPress: () => void; kind?: Kind; disabled?: boolean; busy?: boolean; style?: ViewStyle;
}) {
  const solid = kind === 'solid';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || busy) }}
      style={({ pressed }) => [
        s.btn,
        solid ? { backgroundColor: C.accent } : kind === 'outline' ? { borderWidth: 1.5, borderColor: C.ink } : null,
        (disabled || pressed) && { opacity: disabled ? 0.45 : 0.8 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={solid ? '#fff' : C.ink} />
        : <Text style={{ color: solid ? '#fff' : C.ink, fontWeight: '800', fontSize: 15 }}>{title}</Text>}
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
      style={[s.chip, on ? { backgroundColor: C.ink, borderColor: C.ink } : { borderColor: C.line }]}>
      <Text style={{ color: on ? '#fff' : C.ink, fontWeight: '700', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  btn: { minHeight: 48, paddingHorizontal: 18, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 14, gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, borderWidth: 1.5 },
});
