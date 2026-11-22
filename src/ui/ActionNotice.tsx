// The note above the anchored buttons after an action: its error, that it waits offline, or its undo.
import { Undo2 } from 'lucide-react-native';
import { Platform, Pressable, StyleSheet, Text } from 'react-native';

import { androidRipple, pressedStyle, tapHaptic } from './feedback';
import { colors, fontSizes, layout, radii } from './theme';

/** Android hears it through the live region; iOS callers announce it with `ui/a11y.ts`. */
export function ActionNotice({ tone, children }: { tone: 'error' | 'queued'; children: string }): React.JSX.Element {
  return (
    <Text
      style={[styles.notice, tone === 'error' ? styles.error : styles.queued]}
      accessibilityLiveRegion="polite"
      {...(tone === 'error' ? { accessibilityRole: 'alert' as const } : {})}
    >
      {children}
    </Text>
  );
}

/** The undo button in the same slot, while the action can still be taken back. */
export function UndoNotice({
  label,
  hint,
  onPress,
}: {
  label: string;
  hint: string;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={() => {
        tapHaptic('selection');
        onPress();
      }}
      android_ripple={androidRipple}
      style={({ pressed }) => [styles.undo, pressed && Platform.OS === 'ios' && pressedStyle]}
    >
      <Undo2 size={16} color={colors.accentText} />
      <Text style={styles.undoLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  notice: {
    alignSelf: 'center',
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.cell,
    textAlign: 'center',
    fontSize: fontSizes.body,
  },
  error: {
    backgroundColor: colors.errorTint,
    color: colors.error,
  },
  queued: {
    backgroundColor: colors.tint,
    color: colors.ink,
  },
  undo: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: layout.minHitTarget,
    paddingHorizontal: 18,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.surface,
  },
  undoLabel: {
    color: colors.accentText,
    fontSize: fontSizes.body,
    fontWeight: '700',
  },
});
