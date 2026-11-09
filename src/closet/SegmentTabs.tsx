import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, layout, radii } from '../ui/theme';

const SEGMENT_HEIGHT = 34;
const PADDING = 3;
// The pill stays mockup-thin; hitSlop tops each segment up to the 44 pt minimum.
const VERTICAL_SLOP = (layout.minHitTarget - SEGMENT_HEIGHT) / 2;

export type SegmentOption<T extends string> = { value: T; label: string };

/** Mockup 04's `.seg`: a pill segmented control (Items | Stats | Diary), one tab per option. */
export function SegmentTabs<T extends string>(props: {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (next: T) => void;
  accessibilityLabel: string;
}): React.JSX.Element {
  const { options, value, onChange, accessibilityLabel } = props;
  return (
    <View style={styles.track} accessibilityRole="tablist" accessibilityLabel={accessibilityLabel}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            hitSlop={{ top: VERTICAL_SLOP, bottom: VERTICAL_SLOP, left: 0, right: 0 }}
            onPress={() => {
              if (!selected) {
                onChange(option.value);
              }
            }}
            style={[styles.segment, selected ? styles.segmentOn : null]}
          >
            <Text style={[styles.label, selected ? styles.labelOn : null]} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    padding: PADDING,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: '#ffffff',
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  segment: {
    flex: 1,
    minHeight: SEGMENT_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
  },
  segmentOn: {
    backgroundColor: colors.commit,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.muted,
  },
  labelOn: {
    color: '#ffffff',
  },
});
