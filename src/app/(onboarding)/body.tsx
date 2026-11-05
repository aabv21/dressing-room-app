import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { useI18n } from '../../i18n';
import { useOnboarding } from '../../profile/OnboardingProvider';
import { bodyToPatch, defaultHeightFor, draftFromProfile } from '../../profile/profileDraft';
import type { BodyErrors, ProfileDraft } from '../../profile/profileDraft';
import { BodySection } from '../../profile/ProfileForm';
import { announceForAccessibility } from '../../ui/a11y';
import { Screen } from '../../ui/Screen';
import { StepBar } from '../../ui/StepBar';
import { colors } from '../../ui/theme';

function BodyStep() {
  const { t } = useI18n();
  const { values, save } = useOnboarding();
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFromProfile(values));
  const [errors, setErrors] = useState<BodyErrors>({});
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  async function handleNext(): Promise<void> {
    setSaveError(undefined);
    // The slider shows the clothing type's default height until it moves; Next saves what it shows.
    const validation = bodyToPatch({ ...draft, heightCm: draft.heightCm ?? defaultHeightFor(draft.clothingType) });
    if (!validation.ok) {
      setErrors(validation.errors);
      const first = Object.values(validation.errors)[0];
      if (first !== undefined) {
        announceForAccessibility(t(first.key, first.params));
      }
      return;
    }
    setErrors({});
    setSaving(true);
    // body_type is always sent, so deselecting a saved silhouette clears it (null).
    const result = await save(validation.patch);
    setSaving(false);
    if (!result.ok) {
      setSaveError(t(result.error));
      announceForAccessibility(t(result.error));
      return;
    }
    router.push('/style');
  }

  return (
    <Screen
      title={t('onboarding.body.title')}
      chrome="none"
      headerAccessory={<StepBar step={2} />}
      cta={{
        secondary: {
          label: t('onboarding.skip'),
          tone: 'ghost',
          disabled: saving,
          onPress: () => {
            router.push('/style');
          },
        },
        primary: {
          label: t('onboarding.next'),
          tone: 'commit',
          disabled: saving,
          onPress: () => {
            void handleNext();
          },
        },
      }}
    >
      <BodySection
        value={draft}
        onChange={(patch) => {
          setDraft((previous) => ({ ...previous, ...patch }));
        }}
        errors={errors}
      />
      {saveError !== undefined ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {saveError}
        </Text>
      ) : null}
    </Screen>
  );
}

export default function BodyRoute() {
  const { status } = useOnboarding();
  return status === 'ready' ? <BodyStep /> : null;
}

const styles = StyleSheet.create({
  error: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '600',
  },
});
