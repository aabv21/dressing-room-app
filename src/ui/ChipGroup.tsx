import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, layout, radii } from './theme';

const CHIP_HEIGHT = 36;
// The visible chip stays mockup-sized (`.chip`); hitSlop tops the tap area up to the 44pt minimum.
const VERTICAL_SLOP = (layout.minHitTarget - CHIP_HEIGHT) / 2;

export type ChipOption<T extends string> = {
  value: T;
  label: string;
  /** A color dot before the label (mockup 02's palette chips). */
  swatch?: string;
  disabled?: boolean;
};

/**
 * A wrap of pill chips (mockup 03 screen 4's `.chips`). `multiple` (default) toggles each value;
 * otherwise it behaves as a radio group where tapping the selected chip clears it. `tone="accent"`
 * is mockup 02 review's `.pick` (violet selection, bold labels); `stretch` gives every chip an equal
 * share of the row, as `.pick` does for its three choices.
 */
export function ChipGroup<T extends string>(props: {
  options: readonly ChipOption<T>[];
  selected: readonly T[];
  onChange: (next: T[]) => void;
  multiple?: boolean;
  tone?: 'commit' | 'accent';
  stretch?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}): React.JSX.Element {
  const { options, selected, onChange, multiple = true, tone = 'commit', stretch = false, accessibilityLabel, testID } = props;
  const accent = tone === 'accent';

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
        const disabled = option.disabled === true;
        return (
          <Pressable
            key={option.value}
            accessibilityRole={multiple ? 'checkbox' : 'radio'}
            accessibilityState={{ checked: isOn, selected: isOn, disabled }}
            accessibilityLabel={option.label}
            disabled={disabled}
            hitSlop={{ top: VERTICAL_SLOP, bottom: VERTICAL_SLOP, left: 2, right: 2 }}
            onPress={() => {
              toggle(option.value);
            }}
            style={[
              styles.chip,
              accent ? styles.chipAccent : null,
              stretch ? styles.stretch : null,
              isOn ? (accent ? styles.chipAccentOn : styles.chipOn) : null,
              disabled ? styles.disabled : null,
            ]}
          >
            {option.swatch === undefined ? null : (
              <View style={[styles.swatch, { backgroundColor: option.swatch }]} />
            )}
            <Text style={[styles.label, accent ? styles.labelAccent : null, isOn ? styles.labelOn : null]}>
              {option.label}
            </Text>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.pill,
  },
  chipOn: {
    backgroundColor: colors.commit,
    borderColor: colors.commit,
  },
  chipAccent: {
    borderColor: colors.tintBorder,
  },
  chipAccentOn: {
    backgroundColor: colors.accentText,
    borderColor: colors.accentText,
  },
  stretch: {
    flexGrow: 1,
    flexBasis: 0,
  },
  disabled: {
    opacity: 0.4,
  },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.15)',
  },
  label: {
    color: colors.ink,
    fontSize: 13,
  },
  labelAccent: {
    fontWeight: '700',
  },
  labelOn: {
    color: '#ffffff',
    fontWeight: '600',
  },
});
