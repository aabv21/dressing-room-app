import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { signOut } from '../../auth/authService';
import type { MessageKey } from '../../i18n';
import { useI18n } from '../../i18n';
import type { ClothingType } from '../../profile/bodyType';
import { useOnboarding } from '../../profile/OnboardingProvider';
import { announceForAccessibility } from '../../ui/a11y';
import { LinkText } from '../../ui/LinkText';
import { OptionCard } from '../../ui/OptionCard';
import { Screen } from '../../ui/Screen';
import { StepBar } from '../../ui/StepBar';
import { colors, spacing } from '../../ui/theme';

const OPTIONS: readonly { value: ClothingType; emoji: string; title: MessageKey; hint: MessageKey }[] = [
  { value: 'feminine', emoji: '👗', title: 'onboarding.clothing.feminine', hint: 'onboarding.clothing.feminineHint' },
  { value: 'masculine', emoji: '👔', title: 'onboarding.clothing.masculine', hint: 'onboarding.clothing.masculineHint' },
  { value: 'everything', emoji: '🧢', title: 'onboarding.clothing.everything', hint: 'onboarding.clothing.everythingHint' },
];

function ClothingStep() {
  const { t } = useI18n();
  const { values, save } = useOnboarding();
  const [selected, setSelected] = useState<ClothingType | null>(values.clothing_type ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function handleNext(): Promise<void> {
    if (selected === null) {
      return;
    }
    setError(undefined);
    setSaving(true);
    const result = await save({ clothing_type: selected });
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
          disabled: selected === null || saving,
          onPress: () => {
            void handleNext();
          },
        },
      }}
    >
      <Text style={styles.subtitle}>{t('onboarding.clothing.subtitle')}</Text>
      <View style={styles.options} accessibilityRole="radiogroup">
        {OPTIONS.map((option) => (
          <OptionCard
            key={option.value}
            emoji={option.emoji}
            title={t(option.title)}
            subtitle={t(option.hint)}
            selected={selected === option.value}
            onPress={() => {
              setSelected(option.value);
            }}
            testID={`clothing-${option.value}`}
          />
        ))}
      </View>
      {error !== undefined ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      {/* P2-R9: onboarding must not be a dead end for someone who signed in with the wrong account. */}
      <View style={styles.signOutRow}>
        <LinkText
          style={styles.signOut}
          onPress={() => {
            void signOut();
          }}
        >
          {t('auth.signOut')}
        </LinkText>
      </View>
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
  options: {
    gap: 10,
    marginTop: spacing.xs,
  },
  error: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '600',
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
