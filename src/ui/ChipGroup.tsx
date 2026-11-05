import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, layout, radii } from './theme';

const CHIP_HEIGHT = 36;
// The visible chip stays mockup-sized (`.chip`); hitSlop tops the tap area up to the 44pt minimum.
const VERTICAL_SLOP = (layout.minHitTarget - CHIP_HEIGHT) / 2;

/**
 * A wrap of pill chips (mockup 03 screen 4's `.chips`). `multiple` (default) toggles each value;
 * otherwise it behaves as a radio group where tapping the selected chip clears it.
 */
export function ChipGroup<T extends string>(props: {
  options: readonly { value: T; label: string }[];
  selected: readonly T[];
  onChange: (next: T[]) => void;
  multiple?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}): React.JSX.Element {
  const { options, selected, onChange, multiple = true, accessibilityLabel, testID } = props;

  function toggle(value: T): void {
    const isOn = selected.includes(value);
    if (multiple) {
      onChange(isOn ? selected.filter((entry) => entry !== value) : [...selected, value]);
      return;
    }
    onChange(isOn ? [] : [value]);
  }

  return (
    <View
      style={styles.wrap}
      accessibilityRole={multiple ? undefined : 'radiogroup'}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {options.map((option) => {
        const isOn = selected.includes(option.value);
        return (
          <Pressable
            key={option.value}
            accessibilityRole={multiple ? 'checkbox' : 'radio'}
            accessibilityState={{ checked: isOn, selected: isOn }}
            accessibilityLabel={option.label}
            hitSlop={{ top: VERTICAL_SLOP, bottom: VERTICAL_SLOP, left: 2, right: 2 }}
            onPress={() => {
              toggle(option.value);
            }}
            style={[styles.chip, isOn ? styles.chipOn : null]}
          >
            <Text style={[styles.label, isOn ? styles.labelOn : null]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 6,
    rowGap: layout.minHitTarget - CHIP_HEIGHT,
  },
  chip: {
    minHeight: CHIP_HEIGHT,
    paddingHorizontal: 14,
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.pill,
  },
  chipOn: {
    backgroundColor: colors.commit,
    borderColor: colors.commit,
  },
  label: {
    color: colors.ink,
    fontSize: 13,
  },
  labelOn: {
    color: '#ffffff',
    fontWeight: '600',
  },
});
