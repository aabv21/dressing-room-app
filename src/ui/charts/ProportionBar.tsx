import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, layout, radii, spacing } from '../theme';

const BAR_HEIGHT = 16;
// A light fill (white, cream, ...) needs a hairline border to stay visible against the card's
// own near-white background (mockup 04's `.prop span { border:1px solid #ddd }` on white).
const LIGHT_FILL_LUMA_THRESHOLD = 0.85;
const LEGEND_SWATCH_SIZE = 9;
const LEGEND_ROW_HEIGHT = 20;
const LEGEND_VERTICAL_SLOP = (layout.minHitTarget - LEGEND_ROW_HEIGHT) / 2;
const SEGMENT_HORIZONTAL_SLOP = 2;
const SEGMENT_VERTICAL_SLOP = (layout.minHitTarget - BAR_HEIGHT) / 2;

export type ProportionSegment = { id: string; label: string; pct: number; hex: string };

function relativeLuma(hex: string): number {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (match?.[1] === undefined) {
    return 0;
  }
  const value = match[1];
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function needsHairline(hex: string): boolean {
  return relativeLuma(hex) >= LIGHT_FILL_LUMA_THRESHOLD;
}

/**
 * Mockup 04's "Tus colores" proportion bar: real garment hexes, since color is the data itself
 * (not a magnitude hue). Each segment and legend entry taps to the same `onSelect(id)`, both
 * with a 44pt hit target.
 */
export function ProportionBar(props: {
  segments: readonly ProportionSegment[];
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const { segments, onSelect } = props;

  return (
    <View>
      <View style={styles.bar}>
        {segments.map((segment) => (
          <Pressable
            key={segment.id}
            testID={`proportion-segment-${segment.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${segment.label} ${String(segment.pct)}%`}
            hitSlop={{
              top: SEGMENT_VERTICAL_SLOP,
              bottom: SEGMENT_VERTICAL_SLOP,
              left: SEGMENT_HORIZONTAL_SLOP,
              right: SEGMENT_HORIZONTAL_SLOP,
            }}
            onPress={() => {
              onSelect(segment.id);
            }}
            style={[
              styles.segment,
              { flex: segment.pct, backgroundColor: segment.hex },
              needsHairline(segment.hex) ? styles.hairline : null,
            ]}
          />
        ))}
      </View>
      <View style={styles.legend}>
        {segments.map((segment) => (
          <Pressable
            key={segment.id}
            testID={`proportion-legend-${segment.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${segment.label} ${String(segment.pct)}%`}
            hitSlop={{ top: LEGEND_VERTICAL_SLOP, bottom: LEGEND_VERTICAL_SLOP, left: 4, right: 4 }}
            onPress={() => {
              onSelect(segment.id);
            }}
            style={styles.legendEntry}
          >
            <View
              style={[
                styles.swatch,
                { backgroundColor: segment.hex },
                needsHairline(segment.hex) ? styles.hairline : null,
              ]}
            />
            <Text style={styles.legendLabel}>
              {segment.label} {segment.pct}%
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    height: BAR_HEIGHT,
    gap: 2,
  },
  segment: {
    borderRadius: radii.cell / 3,
  },
  hairline: {
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
    columnGap: spacing.md - 6,
    rowGap: 0,
  },
  legendEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: LEGEND_ROW_HEIGHT,
    gap: spacing.xs,
  },
  swatch: {
    width: LEGEND_SWATCH_SIZE,
    height: LEGEND_SWATCH_SIZE,
    borderRadius: 3,
  },
  legendLabel: {
    fontSize: 12,
    color: colors.ink,
  },
});
