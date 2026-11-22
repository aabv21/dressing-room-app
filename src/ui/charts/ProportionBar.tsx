import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSizes, layout, radii, spacing } from '../theme';

const BAR_HEIGHT = 16;
// A light fill (white, cream, ...) needs a hairline border to stay visible on the near-white card.
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
 * Real garment hexes, since color is the data itself. Segments and legend entries tap to the same
 * `onSelect(id)` (44pt targets); screen readers get the legend entries only.
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
            // The legend below names each color with its share; a screen reader reads it there once.
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
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
    borderColor: colors.swatchEdgeSoft,
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
    fontSize: fontSizes.caption,
    color: colors.ink,
  },
});
