import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n';
import { useOnboarding } from '../../profile/OnboardingProvider';
import { draftFromProfile, styleToPatch } from '../../profile/profileDraft';
import type { ProfileDraft } from '../../profile/profileDraft';
import { StyleSection } from '../../profile/ProfileForm';
import { announceForAccessibility } from '../../ui/a11y';
import { Screen } from '../../ui/Screen';
import { StepBar } from '../../ui/StepBar';
import { colors } from '../../ui/theme';

function StyleStep() {
  const { t } = useI18n();
  const { values, save, finish } = useOnboarding();
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFromProfile(values));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<MessageKey | undefined>(undefined);

  async function submit(saveFirst: boolean): Promise<void> {
    setError(undefined);
    setSubmitting(true);
    let result: { ok: true } | { ok: false; error: MessageKey } = { ok: true };
    if (saveFirst) {
      result = await save(styleToPatch(draft));
    }
    if (result.ok) {
      result = await finish();
    }
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      announceForAccessibility(t(result.error));
    }
  }

  return (
    <Screen
      title={t('onboarding.style.title')}
      chrome="none"
      headerAccessory={<StepBar step={3} />}
      cta={{
        secondary: {
          label: t('onboarding.skip'),
          tone: 'ghost',
          disabled: submitting,
          onPress: () => {
            void submit(false);
          },
        },
        primary: {
          label: t('onboarding.start'),
          tone: 'ai',
          disabled: submitting,
          onPress: () => {
            void submit(true);
          },
        },
      }}
    >
      <StyleSection
        value={draft}
        onChange={(patch) => {
          setDraft((previous) => ({ ...previous, ...patch }));
        }}
      />
      {error !== undefined ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {t(error)}
        </Text>
      ) : null}
    </Screen>
  );
}

export default function StyleRoute() {
  const { status } = useOnboarding();
  return status === 'ready' ? <StyleStep /> : null;
}

const styles = StyleSheet.create({
  error: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '600',
  },
});
