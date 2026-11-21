import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useRef, useState } from 'react';
import type { TextInputInstance } from 'react-native';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { confirmPasswordReset, requestPasswordReset } from '../../auth/authService';
import type { Result } from '../../auth/authService';
import { isValidEmail } from '../../auth/validation';
import { useI18n } from '../../i18n';
import { announceForAccessibility } from '../../ui/a11y';
import { LinkText } from '../../ui/LinkText';
import { Screen } from '../../ui/Screen';
import { colors } from '../../ui/theme';
import { TextField } from '../../ui/TextField';

const MIN_PASSWORD_LENGTH = 8;
const CODE_LENGTH = 6;

type Step = 'email' | 'code';

export default function ForgotPasswordScreen() {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [codeError, setCodeError] = useState<string | undefined>(undefined);
  const [passwordError, setPasswordError] = useState<string | undefined>(undefined);
  const [codeSent, setCodeSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const newPasswordRef = useRef<TextInputInstance>(null);
  const confirmPasswordRef = useRef<TextInputInstance>(null);

  function announce(message: string): void {
    announceForAccessibility(message);
  }

  /** For the first send and the resend; returns the outcome because each step shows errors elsewhere. */
  async function sendCode(): Promise<{ ok: true } | { ok: false; message: string }> {
    const trimmedEmail = email.trim();
    if (trimmedEmail === '') {
      return { ok: false, message: t('auth.error.emailRequired') };
    }
    if (!isValidEmail(trimmedEmail)) {
      return { ok: false, message: t('auth.error.emailInvalid') };
    }
    const result: Result = await requestPasswordReset(trimmedEmail);
    if (!result.ok) {
      return { ok: false, message: t(result.error) };
    }
    return { ok: true };
  }

  async function handleInitialSend(): Promise<void> {
    setEmailError(undefined);
    setSubmitting(true);
    try {
      const outcome = await sendCode();
      if (!outcome.ok) {
        setEmailError(outcome.message);
        announce(outcome.message);
        return;
      }
      setStep('code');
    } finally {
      setSubmitting(false);
    }
  }

  /** Reports to `codeError`: step 2 never shows the email field's error, so it would be swallowed. */
  async function handleResend(): Promise<void> {
    setCodeError(undefined);
    setCodeSent(false);
    setResending(true);
    try {
      const outcome = await sendCode();
      if (!outcome.ok) {
        setCodeError(outcome.message);
        announce(outcome.message);
        return;
      }
      setCodeSent(true);
      announce(t('auth.forgotPassword.codeSent'));
    } finally {
      setResending(false);
    }
  }

  async function handleConfirm(): Promise<void> {
    setCodeError(undefined);
    setPasswordError(undefined);
    if (code.length !== CODE_LENGTH || !/^\d+$/.test(code)) {
      const message = t('auth.error.invalidCodeFormat');
      setCodeError(message);
      announce(message);
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      const message = t('auth.error.weakPassword');
      setPasswordError(message);
      announce(message);
      return;
    }
    if (newPassword !== confirmPassword) {
      const message = t('auth.error.passwordMismatch');
      setPasswordError(message);
      announce(message);
      return;
    }
    setSubmitting(true);
    try {
      const result = await confirmPasswordReset(email.trim(), code, newPassword);
      if (!result.ok) {
        // A failure keeps the user on step 2 with "Send a new code" rather than losing their email.
        // On success the guard navigates: a fresh session is a normal sign-in to AuthProvider.
        const message = t(result.error);
        setCodeError(message);
        announce(message);
        return;
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleChangeEmail(): void {
    setStep('email');
    setCodeError(undefined);
    setPasswordError(undefined);
    // Back through "Change email": drop step 2's code and confirmation.
    setCode('');
    setCodeSent(false);
  }

  const backButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={step === 'code' ? t('auth.forgotPassword.backToEmail') : t('auth.back')}
      hitSlop={8}
      style={styles.backButton}
      onPress={() => {
        if (step === 'code') {
          handleChangeEmail();
          return;
        }
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace('/sign-in');
        }
      }}
    >
      <ChevronLeft size={22} color={colors.ink} />
    </Pressable>
  );

  if (step === 'email') {
    return (
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Screen
          title={t('auth.forgotPassword.title')}
          chrome="none"
          headerAccessory={backButton}
          cta={{
            primary: {
              label: t('auth.forgotPassword.sendCode'),
              tone: 'commit',
              onPress: () => {
                void handleInitialSend();
              },
              disabled: submitting,
            },
          }}
        >
          <Text style={styles.subtitle}>{t('auth.forgotPassword.step1.subtitle')}</Text>
          <TextField
            label={t('auth.field.email')}
            placeholder={t('auth.field.emailPlaceholder')}
            showLabel={false}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="done"
            onSubmitEditing={() => {
              void handleInitialSend();
            }}
            error={emailError}
            testID="forgot-password-email"
          />
          <LinkText
            style={styles.link}
            onPress={() => {
              router.replace('/sign-in');
            }}
          >
            {t('auth.forgotPassword.backToSignIn')}
          </LinkText>
        </Screen>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen
        title={t('auth.forgotPassword.title')}
        chrome="none"
        headerAccessory={backButton}
        cta={{
          primary: {
            label: t('auth.forgotPassword.confirm'),
            tone: 'commit',
            onPress: () => {
              void handleConfirm();
            },
            disabled: submitting,
          },
        }}
      >
        <Text style={styles.subtitle}>{t('auth.forgotPassword.step2.subtitle')}</Text>
        <TextField
          label={t('auth.field.code')}
          placeholder={t('auth.field.codePlaceholder')}
          showLabel={false}
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={CODE_LENGTH}
          returnKeyType="next"
          onSubmitEditing={() => {
            newPasswordRef.current?.focus();
          }}
          submitBehavior="submit"
          error={codeError}
          testID="forgot-password-code"
        />
        <TextField
          ref={newPasswordRef}
          label={t('auth.field.newPassword')}
          placeholder={t('auth.field.newPasswordPlaceholder')}
          showLabel={false}
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="next"
          onSubmitEditing={() => {
            confirmPasswordRef.current?.focus();
          }}
          submitBehavior="submit"
          testID="forgot-password-new-password"
        />
        <TextField
          ref={confirmPasswordRef}
          label={t('auth.field.confirmPassword')}
          placeholder={t('auth.field.confirmPasswordPlaceholder')}
          showLabel={false}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="done"
          onSubmitEditing={() => {
            void handleConfirm();
          }}
          error={passwordError}
          testID="forgot-password-confirm-password"
        />
        {codeSent ? (
          <Text style={styles.codeSent} accessibilityLiveRegion="polite">
            {t('auth.forgotPassword.codeSent')}
          </Text>
        ) : null}
        <View style={styles.footerRow}>
          <LinkText
            style={styles.link}
            onPress={handleChangeEmail}
          >
            {t('auth.forgotPassword.backToEmail')}
          </LinkText>
          <LinkText
            style={styles.link}
            disabled={resending}
            onPress={() => {
              void handleResend();
            }}
          >
            {t('auth.forgotPassword.resendCode')}
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
  backButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
  },
  link: {
    color: colors.accent,
    fontWeight: '700',
    fontSize: 13,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  codeSent: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
  },
});
