import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { androidRipple, pressedStyle, tapHaptic } from './feedback';

import { colors, layout, selectionRing, textScale } from './theme';

/** A large single-choice card: emoji, bold title, muted subtitle. */
export function OptionCard(props: {
  emoji: string;
  title: string;
  subtitle: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}): React.JSX.Element {
  const { emoji, title, subtitle, selected, onPress, testID } = props;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={`${title}. ${subtitle}`}
      onPress={() => {
        tapHaptic('selection');
        onPress();
      }}
      android_ripple={androidRipple}
      style={({ pressed }) => [styles.card, selected ? styles.cardOn : null, pressed && Platform.OS === 'ios' && pressedStyle]}
      testID={testID}
    >
      <Text
        style={styles.emoji}
        importantForAccessibility="no"
        accessibilityElementsHidden
        maxFontSizeMultiplier={textScale.emoji}
      >
        {emoji}
      </Text>
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: layout.minHitTarget,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: colors.hairline,
    borderRadius: 16,
  },
  cardOn: {
    borderColor: colors.accent,
    boxShadow: selectionRing,
  },
  emoji: {
    fontSize: 28,
    lineHeight: 34,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
  },
});
