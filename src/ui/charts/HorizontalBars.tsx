import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useLargeText } from '../layout';
import { colors, fontSizes, layout, spacing } from '../theme';

const GROW_DURATION_MS = 450;
const LABEL_WIDTH = 92;
const VALUE_WIDTH = 28;
const BAR_HEIGHT = 9;
// The visible track is thin (9pt); hitSlop tops the row's tap area up to the 44pt minimum.
const ROW_HEIGHT = 32;
const VERTICAL_SLOP = (layout.minHitTarget - ROW_HEIGHT) / 2;

export type HorizontalBarRow = { id: string; label: string; value: number; valueLabel: string };

function Bar({ id, pct, color, stacked }: { id: string; pct: number; color: string; stacked: boolean }) {
  const reducedMotion = useReducedMotion();
  const width = useSharedValue(reducedMotion ? pct : 0);

  // A shared value never re-renders React, so the width is read in a worklet. No deps array (reanimated
  // ignores it on native and warns); declared before the effect so it subscribes before any write.
  const fillStyle = useAnimatedStyle(() => ({ width: `${String(width.value)}%` }));

  useEffect(() => {
    if (reducedMotion) {
      width.value = pct;
      return;
    }
    width.value = withTiming(pct, { duration: GROW_DURATION_MS });
    // Only `pct` changes; `width` and `reducedMotion` are stable for a row's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pct]);

  return (
    <View style={[styles.track, stacked ? null : styles.trackInRow]}>
      <Animated.View testID={`bar-fill-${id}`} style={[styles.fill, { backgroundColor: color }, fillStyle]} />
    </View>
  );
}

/**
 * Bars that grow in on mount (not under reduced motion). With `onSelect` rows are buttons and the
 * selected one shows `detail` inline; without it they're read-only. Text is never capped: columns grow
 * up to `LARGE_TEXT_FONT_SCALE`, above it a row stacks label and value over a full-width bar.
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
  const { fontScale } = useWindowDimensions();
  const stacked = useLargeText();
  const scale = Math.max(fontScale, 1);
  const rowStyle = stacked ? styles.rowStacked : styles.row;
  const labelStyle = stacked ? [styles.label, styles.labelStacked] : [styles.label, { width: LABEL_WIDTH * scale }];
  const valueStyle = stacked ? styles.value : [styles.value, { width: valueWidth * scale }];
  const detailIndent = stacked ? 0 : LABEL_WIDTH * scale + spacing.sm - 2;

  return (
    <View style={styles.list}>
      {rows.map((row) => {
        const isSelected = row.id === selectedId;
        const pct = (row.value / max) * 100;
        const label = (
          <Text style={labelStyle} {...(stacked ? {} : { numberOfLines: 1 })}>
            {row.label}
          </Text>
        );
        const value = (
          <Text style={valueStyle} {...(stacked ? {} : { numberOfLines: 1 })}>
            {row.valueLabel}
          </Text>
        );
        const content = stacked ? (
          <>
            <View style={styles.stackedHeader}>
              {label}
              {value}
            </View>
            <Bar id={row.id} pct={pct} color={color} stacked={stacked} />
          </>
        ) : (
          <>
            {label}
            <Bar id={row.id} pct={pct} color={color} stacked={stacked} />
            {value}
          </>
        );
        const accessibilityLabel = `${row.label}, ${row.valueLabel}`;
        if (onSelect === undefined) {
          return (
            <View
              key={row.id}
              testID={`bar-row-${row.id}`}
              accessible
              accessibilityLabel={accessibilityLabel}
              style={rowStyle}
            >
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
              testID={`bar-row-${row.id}`}
              style={rowStyle}
            >
              {content}
            </Pressable>
            {isSelected && detail !== undefined ? (
              <Text style={[styles.detail, { marginLeft: detailIndent }]}>{detail}</Text>
            ) : null}
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
  // Above the large-text threshold: the label and value on one line (wrapping), the bar under them.
  rowStacked: {
    flexDirection: 'column',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  stackedHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    columnGap: spacing.sm,
  },
  label: {
    fontSize: fontSizes.caption,
    color: colors.ink,
  },
  labelStacked: {
    flexShrink: 1,
  },
  track: {
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    backgroundColor: colors.track,
    overflow: 'hidden',
  },
  trackInRow: {
    flex: 1,
  },
  fill: {
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
  },
  value: {
    textAlign: 'right',
    fontSize: fontSizes.caption,
    color: colors.muted,
    fontVariant: ['tabular-nums'],
  },
  detail: {
    fontSize: fontSizes.micro,
    color: colors.muted,
    marginTop: -2,
    marginBottom: spacing.xs,
  },
});
