import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { androidRipple, pressedStyle, tapHaptic } from '../ui/feedback';
import { colors, layout, radii, textScale } from '../ui/theme';

const SEGMENT_HEIGHT = 34;
const PADDING = 3;
// The pill stays thin; hitSlop tops each segment up to the 44 pt minimum.
const VERTICAL_SLOP = (layout.minHitTarget - SEGMENT_HEIGHT) / 2;

export type SegmentOption<T extends string> = { value: T; label: string };

/** A pill segmented control (Items | Stats | Diary), one tab per option. */
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
            // The label's size is capped to fit its third of the pill; a long press shows it enlarged (iOS).
            accessibilityShowsLargeContentViewer
            accessibilityLargeContentTitle={option.label}
            hitSlop={{ top: VERTICAL_SLOP, bottom: VERTICAL_SLOP, left: 0, right: 0 }}
            onPress={() => {
              if (!selected) {
                tapHaptic('selection');
                onChange(option.value);
              }
            }}
            android_ripple={androidRipple}
            style={({ pressed }) => [styles.segment, selected ? styles.segmentOn : null, pressed && Platform.OS === 'ios' && pressedStyle]}
          >
            <Text
              style={[styles.label, selected ? styles.labelOn : null]}
              numberOfLines={1}
              maxFontSizeMultiplier={textScale.compact}
            >
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
