// The back chevron beside a pushed screen's title (rate, garment detail, review).
import { ChevronLeft } from 'lucide-react-native';
import { Pressable, StyleSheet } from 'react-native';

import { colors, layout } from './theme';

export function BackChevron({ label, onPress }: { label: string; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      // Narrower than 44 pt so the title sits close to it; the slop keeps the 44 pt target.
      hitSlop={{ left: 8, right: 6 }}
      style={styles.button}
      onPress={onPress}
    >
      <ChevronLeft size={22} color={colors.ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 30,
    minHeight: layout.minHitTarget,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
});
