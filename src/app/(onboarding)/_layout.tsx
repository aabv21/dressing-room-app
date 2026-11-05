import { Stack } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useSignOut } from '../../auth/useSignOut';
import { useI18n } from '../../i18n';
import { OnboardingProvider, useOnboarding } from '../../profile/OnboardingProvider';
import { AnchoredCta } from '../../ui/AnchoredCta';
import { LinkText } from '../../ui/LinkText';
import { colors, gradients, spacing } from '../../ui/theme';

/** Covers the steps until the profile has been (re-)read; see OnboardingProvider for why. */
function ProfileGate(): React.JSX.Element | null {
  const { t } = useI18n();
  const { status, reload } = useOnboarding();
  const signOut = useSignOut();

  if (status === 'ready') {
    return null;
  }

  return (
    <LinearGradient colors={gradients.background} style={StyleSheet.absoluteFill} testID="onboarding-gate">
      <View style={styles.center}>
        {status === 'loading' ? (
          <ActivityIndicator color={colors.accent} accessibilityLabel={t('onboarding.loading')} />
        ) : (
          <>
            <Text style={styles.message} accessibilityLiveRegion="polite">
              {t('onboarding.loadError')}
            </Text>
            <LinkText style={styles.signOut} disabled={signOut.signingOut} onPress={signOut.signOut}>
              {t('auth.signOut')}
            </LinkText>
            {signOut.error !== undefined ? (
              <Text style={styles.error} accessibilityLiveRegion="polite">
                {t(signOut.error)}
              </Text>
            ) : null}
          </>
        )}
      </View>
      {status === 'error' ? (
        <AnchoredCta chrome="none" primary={{ label: t('onboarding.retry'), tone: 'commit', onPress: reload }} />
      ) : null}
    </LinearGradient>
  );
}

export default function OnboardingLayout() {
  return (
    <OnboardingProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="clothing" />
        <Stack.Screen name="body" />
        <Stack.Screen name="style" />
      </Stack>
      <ProfileGate />
    </OnboardingProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  message: {
    color: colors.ink,
    fontSize: 15,
    textAlign: 'center',
  },
  signOut: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  error: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
});
