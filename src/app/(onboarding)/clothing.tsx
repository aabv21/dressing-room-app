import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useSignOut } from '../../auth/useSignOut';
import { useI18n } from '../../i18n';
import { useOnboarding } from '../../profile/OnboardingProvider';
import { draftFromProfile } from '../../profile/profileDraft';
import type { ProfileDraft } from '../../profile/profileDraft';
import { ClothingSection } from '../../profile/ProfileForm';
import { announceForAccessibility } from '../../ui/a11y';
import { LinkText } from '../../ui/LinkText';
import { Screen } from '../../ui/Screen';
import { StepBar } from '../../ui/StepBar';
import { colors } from '../../ui/theme';

function ClothingStep() {
  const { t } = useI18n();
  const { values, save } = useOnboarding();
  const signOut = useSignOut();
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFromProfile(values));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function handleNext(): Promise<void> {
    if (draft.clothingType === null) {
      return;
    }
    setError(undefined);
    setSaving(true);
    // A saved silhouette the new clothing type doesn't offer was cleared by the section; save that
    // too, so it doesn't linger as a hidden mismatch.
    const savedBodyType = values.body_type ?? null;
    const result = await save({
      clothing_type: draft.clothingType,
      ...(draft.bodyType !== savedBodyType ? { body_type: draft.bodyType } : {}),
    });
    setSaving(false);
    if (!result.ok) {
      setError(t(result.error));
      announceForAccessibility(t(result.error));
      return;
    }
    router.push('/body');
  }

  return (
    <Screen
      title={t('onboarding.clothing.title')}
      chrome="none"
      headerAccessory={<StepBar step={1} />}
      cta={{
        primary: {
          label: t('onboarding.next'),
          tone: 'commit',
          disabled: draft.clothingType === null || saving,
          onPress: () => {
            void handleNext();
          },
        },
      }}
    >
      <Text style={styles.subtitle}>{t('onboarding.clothing.subtitle')}</Text>
      <ClothingSection
        value={draft}
        onChange={(patch) => {
          setDraft((previous) => ({ ...previous, ...patch }));
        }}
      />
      {error !== undefined ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      {/* Onboarding must not be a dead end for someone who signed in with the wrong account. */}
      <View style={styles.signOutRow}>
        <LinkText style={styles.signOut} disabled={signOut.signingOut} onPress={signOut.signOut}>
          {t('auth.signOut')}
        </LinkText>
      </View>
      {signOut.error !== undefined ? (
        <Text style={[styles.error, styles.centered]} accessibilityLiveRegion="polite">
          {t(signOut.error)}
        </Text>
      ) : null}
    </Screen>
  );
}

export default function ClothingRoute() {
  const { status } = useOnboarding();
  return status === 'ready' ? <ClothingStep /> : null;
}

const styles = StyleSheet.create({
  subtitle: {
    color: colors.muted,
    fontSize: 13,
  },
  error: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '600',
  },
  centered: {
    textAlign: 'center',
  },
  signOutRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  signOut: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
  },
});
