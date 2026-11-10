import { Pressable, StyleSheet, Text } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';

import { layout } from './theme';

/**
 * A text link with a guaranteed 44pt tap target — plain `Text` with `onPress` doesn't accept
 * `hitSlop` in this RN version's types (and visually its hit area is just the glyph bounds), so
 * every tappable auth-screen link goes through this `Pressable` wrapper instead.
 */
export function LinkText(props: {
  children: string;
  onPress: () => void;
  style?: StyleProp<TextStyle>;
  disabled?: boolean;
}): React.JSX.Element {
  const { children, onPress, style, disabled = false } = props;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.hitArea}
      hitSlop={6}
    >
      <Text style={[style, disabled ? styles.disabled : null]}>{children}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hitArea: {
    minHeight: layout.minHitTarget,
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
});
