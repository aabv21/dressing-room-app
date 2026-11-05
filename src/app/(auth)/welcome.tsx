import { router } from 'expo-router';
import { useRef, useState } from 'react';
import type { TextInputInstance } from 'react-native';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';

import { signInWithApple, signInWithGoogle, signUpWithEmail } from '../../auth/authService';
import { isValidEmail } from '../../auth/validation';
import { useI18n } from '../../i18n';
import { announceForAccessibility } from '../../ui/a11y';
import { LanguageToggle } from '../../ui/LanguageToggle';
import { LinkText } from '../../ui/LinkText';
import { Screen } from '../../ui/Screen';
import { SocialButton } from '../../ui/SocialButton';
import { colors, spacing } from '../../ui/theme';
import { TextField } from '../../ui/TextField';

const MIN_PASSWORD_LENGTH = 8;

export default function WelcomeScreen() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [socialError, setSocialError] = useState<string | undefined>(undefined);
  const [checkEmail, setCheckEmail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [socialSubmitting, setSocialSubmitting] = useState(false);
  const passwordRef = useRef<TextInputInstance>(null);

  function showFieldError(message: string): void {
    setFieldError(message);
    announceForAccessibility(message);
  }

  async function handleCreateAccount(): Promise<void> {
    setFieldError(undefined);
    setCheckEmail(false);
    const trimmedEmail = email.trim();
    if (trimmedEmail === '') {
      showFieldError(t('auth.error.emailRequired'));
      return;
    }
    if (!isValidEmail(trimmedEmail)) {
      showFieldError(t('auth.error.emailInvalid'));
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      showFieldError(t('auth.error.weakPassword'));
      return;
    }
    setSubmitting(true);
    try {
      const result = await signUpWithEmail(trimmedEmail, password);
      if (!result.ok) {
        showFieldError(t(result.error));
        return;
      }
      // Ruling P2-R6 / I5: `needsConfirmation` is only true once the integration session turns
      // Supabase email confirmations on — locally and in v1 (confirmations off) `signUp` already
      // returns a session, `AuthProvider`'s `onAuthStateChange` picks it up, and the root guard
      // navigates on its own with no message needed here.
      if (result.needsConfirmation) {
        setCheckEmail(true);
        announceForAccessibility(t('auth.checkEmail'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApple(): Promise<void> {
    setSocialError(undefined);
    setSocialSubmitting(true);
    try {
      const result = await signInWithApple();
      // A user cancel is an ordinary dismissal, not an error — show nothing (M4).
      if (!result.ok && result.error !== 'auth.error.cancelled') {
        setSocialError(t(result.error));
        announceForAccessibility(t(result.error));
      }
    } finally {
      setSocialSubmitting(false);
    }
  }

  async function handleGoogle(): Promise<void> {
    setSocialError(undefined);
    setSocialSubmitting(true);
    try {
      const result = await signInWithGoogle();
      if (!result.ok && result.error !== 'auth.error.cancelled') {
        setSocialError(t(result.error));
        announceForAccessibility(t(result.error));
      }
    } finally {
      setSocialSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Screen
        title={t('auth.welcome.title')}
        titleVariant="hero"
        chrome="none"
        headerAccessory={
          <View style={styles.languageRow} testID="welcome-language-row">
            <LanguageToggle />
          </View>
        }
        cta={{
          primary: {
            label: t('auth.welcome.cta'),
            tone: 'commit',
            onPress: () => {
              void handleCreateAccount();
            },
            // M4: disabled during a social sign-in too, not just its own email/password submit —
            // a tap here while Apple/Google is mid-flow would otherwise fire a second signUp.
            disabled: submitting || socialSubmitting,
          },
        }}
      >
        <Text style={styles.subtitle}>{t('auth.welcome.subtitle')}</Text>

        <View testID="welcome-social-section" style={styles.socialSection}>
          <SocialButton
            provider="apple"
            disabled={socialSubmitting || submitting}
            onPress={() => {
              void handleApple();
            }}
          />
          <SocialButton
            provider="google"
            disabled={socialSubmitting || submitting}
            onPress={() => {
              void handleGoogle();
            }}
          />
          {socialError !== undefined ? (
            <Text style={styles.socialError} accessibilityLiveRegion="polite">
              {socialError}
            </Text>
          ) : null}
        </View>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerLabel}>{t('auth.divider.email')}</Text>
          <View style={styles.dividerLine} />
        </View>

        <TextField
          label={t('auth.field.email')}
          placeholder={t('auth.field.emailPlaceholder')}
          showLabel={false}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => {
            passwordRef.current?.focus();
          }}
          submitBehavior="submit"
          testID="welcome-email"
        />
        <TextField
          ref={passwordRef}
          label={t('auth.field.password')}
          placeholder={t('auth.field.passwordPlaceholder')}
          showLabel={false}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="done"
          onSubmitEditing={() => {
            void handleCreateAccount();
          }}
          error={fieldError}
          testID="welcome-password"
        />
        {checkEmail ? (
          <Text style={styles.checkEmail} accessibilityLiveRegion="polite">
            {t('auth.checkEmail')}
          </Text>
        ) : null}

        <View style={styles.footerRow}>
          <LinkText
            style={styles.link}
            onPress={() => {
              router.push('/forgot-password');
            }}
          >
            {t('auth.forgotPassword')}
          </LinkText>
          <LinkText
            style={styles.muted}
            onPress={() => {
              router.replace('/sign-in');
            }}
          >
            {t('auth.haveAccount')}
          </LinkText>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  languageRow: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
  },
  socialSection: {
    gap: spacing.sm,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.hairline,
  },
  dividerLabel: {
    color: colors.muted,
    fontSize: 12,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
  },
  link: {
    color: colors.accent,
    fontWeight: '700',
    fontSize: 13,
  },
  muted: {
    color: colors.muted,
    fontSize: 13,
  },
  checkEmail: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  socialError: {
    color: '#c0392b',
    fontSize: 12,
    fontWeight: '600',
  },
});
