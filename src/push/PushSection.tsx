// Profile's "Notifications from the app": the two server notices, both off until turned on
// (docs/app.md#notifications-from-the-app-srcpush).
import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { useI18n, type MessageKey } from '../i18n';
import { announceForAccessibility } from '../ui/a11y';
import { OpenSettingsLink } from '../ui/OpenSettingsLink';
import { colors, fontSizes, layout, spacing } from '../ui/theme';
import { setPushPreferences, type PushPreferences } from './pushRegistration';
import { usePushSettings } from './pushStore';

type Problem = 'denied' | 'unavailable' | 'failed';

function problemText(problem: Problem): MessageKey {
  switch (problem) {
    case 'denied':
      return 'push.denied';
    case 'unavailable':
      return 'push.unavailable';
    case 'failed':
      return 'push.failed';
  }
}

function NoticeRow({
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}): React.JSX.Element {
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
      <Switch
        accessibilityLabel={label}
        accessibilityHint={hint}
        value={value}
        disabled={disabled}
        trackColor={{ true: colors.accent, false: colors.track }}
        onValueChange={onChange}
      />
    </View>
  );
}

export function PushSection({ userId }: { userId: string }): React.JSX.Element {
  const { t, locale } = useI18n();
  const settings = usePushSettings(userId);
  // The switches show the requested choices while the prompt, token fetch and save run.
  const [pending, setPending] = useState<PushPreferences | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const shown = pending ?? { reviewReady: settings.reviewReady, weekly: settings.weekly };

  async function change(next: PushPreferences): Promise<void> {
    setProblem(null);
    setPending(next);
    const outcome = await setPushPreferences(userId, next, locale);
    setPending(null);
    if (outcome === 'saved') {
      announceForAccessibility(t('push.saved'));
      return;
    }
    setProblem(outcome);
    announceForAccessibility(t(problemText(outcome)));
  }

  return (
    <View style={styles.card}>
      <NoticeRow
        label={t('push.reviewReady')}
        hint={t('push.reviewReady.hint')}
        value={shown.reviewReady}
        disabled={pending !== null}
        onChange={(reviewReady) => {
          void change({ ...shown, reviewReady });
        }}
      />
      <View style={styles.divider} />
      <NoticeRow
        label={t('push.weekly')}
        hint={t('push.weekly.hint')}
        value={shown.weekly}
        disabled={pending !== null}
        onChange={(weekly) => {
          void change({ ...shown, weekly });
        }}
      />
      {problem === null ? null : (
        <View style={styles.problem} accessibilityLiveRegion="polite">
          <Text style={styles.error}>{t(problemText(problem))}</Text>
          {problem === 'denied' ? <OpenSettingsLink /> : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: layout.minHitTarget + 8,
    paddingVertical: 6,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    color: colors.ink,
    fontSize: fontSizes.body,
  },
  hint: {
    color: colors.muted,
    fontSize: fontSizes.bodySmall,
  },
  divider: {
    height: 1,
    backgroundColor: colors.hairline,
  },
  problem: {
    paddingBottom: 6,
  },
  error: {
    color: colors.error,
    fontSize: fontSizes.bodySmall,
    fontWeight: '600',
  },
});
