import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { colors, layout, spacing } from '../theme';

const GROW_DURATION_MS = 450;
const LABEL_WIDTH = 92;
const VALUE_WIDTH = 28;
const BAR_HEIGHT = 9;
// The visible track is mockup-thin (9pt); hitSlop tops the row's tap area up to the 44pt minimum.
const ROW_HEIGHT = 32;
const VERTICAL_SLOP = (layout.minHitTarget - ROW_HEIGHT) / 2;

export type HorizontalBarRow = { id: string; label: string; value: number; valueLabel: string };

function Bar({ id, pct, color }: { id: string; pct: number; color: string }) {
  const reducedMotion = useReducedMotion();
  const width = useSharedValue(reducedMotion ? pct : 0);

  // `width` is a shared value: mutating `.value` runs on the UI thread and never triggers a
  // React re-render, so the growing width has to be read inside a worklet (`useAnimatedStyle`)
  // rather than baked into a plain style object read once at mount. The explicit deps array is
  // reanimated's documented fallback for when the Babel plugin can't statically detect which
  // shared values a worklet reads (harmless, and belt-and-suspenders here). Declared before the
  // effect below so it subscribes to `width` before anything has a chance to write to it.
  const fillStyle = useAnimatedStyle(() => ({ width: `${String(width.value)}%` }), [width]);

  useEffect(() => {
    if (reducedMotion) {
      width.value = pct;
      return;
    }
    width.value = withTiming(pct, { duration: GROW_DURATION_MS });
    // Re-run only when the target percentage changes; `width` and `reducedMotion` are stable
    // across the component's lifetime for a given row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pct]);

  return (
    <View style={styles.track}>
      <Animated.View testID={`bar-fill-${id}`} style={[styles.fill, { backgroundColor: color }, fillStyle]} />
    </View>
  );
}

/**
 * Mockup 04's "Lo que más usas" bars: one accent hue, a thin track growing in on mount (skipped
 * under reduced motion), label left / value right. With `onSelect` each row is a button and the
 * selected one shows `detail` beneath it (the mockup's floating tip, flattened to an inline line
 * for touch); without it the rows are read-only (mockup 04's "Balance del clóset").
 * `valueWidth` widens the value column for spelled-out values ("21 wears").
 */
export function HorizontalBars(props: {
  rows: readonly HorizontalBarRow[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  detail?: string;
  color?: string;
  valueWidth?: number;
}): React.JSX.Element {
  const { rows, selectedId = null, onSelect, detail, color = colors.accent, valueWidth = VALUE_WIDTH } = props;
  const max = Math.max(1, ...rows.map((row) => row.value));

  return (
    <View style={styles.list}>
      {rows.map((row) => {
        const isSelected = row.id === selectedId;
        const pct = (row.value / max) * 100;
        const content = (
          <>
            <Text style={styles.label} numberOfLines={1}>
              {row.label}
            </Text>
            <Bar id={row.id} pct={pct} color={color} />
            <Text style={[styles.value, { width: valueWidth }]} numberOfLines={1}>
              {row.valueLabel}
            </Text>
          </>
        );
        const accessibilityLabel = `${row.label}, ${row.valueLabel}`;
        if (onSelect === undefined) {
          return (
            <View key={row.id} accessible accessibilityLabel={accessibilityLabel} style={styles.row}>
              {content}
            </View>
          );
        }
        return (
          <View key={row.id}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={accessibilityLabel}
              hitSlop={{ top: VERTICAL_SLOP, bottom: VERTICAL_SLOP, left: 0, right: 0 }}
              onPress={() => {
                onSelect(row.id);
              }}
              style={styles.row}
            >
              {content}
            </Pressable>
            {isSelected && detail !== undefined ? <Text style={styles.detail}>{detail}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.xs + 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm - 2,
    minHeight: ROW_HEIGHT,
  },
  label: {
    width: LABEL_WIDTH,
    fontSize: 12,
    color: colors.ink,
  },
  track: {
    flex: 1,
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    backgroundColor: colors.track,
    overflow: 'hidden',
  },
  fill: {
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
  },
  value: {
    textAlign: 'right',
    fontSize: 12,
    color: colors.muted,
    fontVariant: ['tabular-nums'],
  },
  detail: {
    fontSize: 11,
    color: colors.muted,
    marginTop: -2,
    marginBottom: spacing.xs,
    marginLeft: LABEL_WIDTH + spacing.sm - 2,
  },
});
