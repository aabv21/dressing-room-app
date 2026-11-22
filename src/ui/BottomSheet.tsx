// A sheet over the bottom of the screen (React Native's `Modal`): a title, the caller's content, and
// a tap outside, the back button or the caller's own button to close it.
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fontSizes, radii, spacing } from './theme';

export function BottomSheet({
  visible,
  title,
  subtitle,
  onClose,
  testID,
  children,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  testID?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const { bottom } = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'fade' : 'slide'}
      onRequestClose={onClose}
      statusBarTranslucent
      {...(testID === undefined ? {} : { testID: `${testID}-modal` })}
    >
      <View style={styles.fill}>
        {/* The scrim closes on a tap; screen readers use the sheet's own Cancel or Close button. */}
        <Pressable style={styles.scrim} onPress={onClose} accessible={false} importantForAccessibility="no" />
        <View
          style={[styles.sheet, { paddingBottom: Math.max(bottom, spacing.md) }]}
          accessibilityViewIsModal
          testID={testID}
        >
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          {subtitle === undefined ? null : <Text style={styles.subtitle}>{subtitle}</Text>}
          {children}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.scrim,
  },
  // A tall sheet stops short of the status bar; its content scrolls instead (ShareOutfitSheet).
  sheet: {
    maxHeight: '90%',
    gap: spacing.sm,
    paddingTop: spacing.md + 4,
    paddingHorizontal: spacing.md,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    backgroundColor: colors.surface,
  },
  title: {
    color: colors.ink,
    fontSize: fontSizes.title,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.muted,
    fontSize: fontSizes.bodySmall,
    marginTop: -spacing.xs,
  },
});
