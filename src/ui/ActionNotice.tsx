// The note above the anchored buttons after an action: its error, or that it waits offline.
import { StyleSheet, Text } from 'react-native';

import { colors, radii } from './theme';

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

const styles = StyleSheet.create({
  notice: {
    alignSelf: 'center',
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.cell,
    textAlign: 'center',
    fontSize: 14,
  },
  error: {
    backgroundColor: colors.errorTint,
    color: colors.error,
  },
  queued: {
    backgroundColor: colors.tint,
    color: colors.ink,
  },
});
