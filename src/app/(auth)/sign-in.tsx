import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useRef, useState } from 'react';
import type { TextInputInstance } from 'react-native';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { signInWithEmail } from '../../auth/authService';
import { isValidEmail } from '../../auth/validation';
import { useI18n } from '../../i18n';
import { announceForAccessibility } from '../../ui/a11y';
import { LinkText } from '../../ui/LinkText';
import { Screen } from '../../ui/Screen';
import { colors } from '../../ui/theme';
import { TextField } from '../../ui/TextField';

export default function SignInScreen() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef<TextInputInstance>(null);

  function showError(message: string): void {
    setError(message);
    announceForAccessibility(message);
  }

  async function handleSignIn(): Promise<void> {
    setError(undefined);
    const trimmedEmail = email.trim();
    if (trimmedEmail === '') {
      showError(t('auth.error.emailRequired'));
      return;
    }
    if (!isValidEmail(trimmedEmail)) {
      showError(t('auth.error.emailInvalid'));
      return;
    }
    setSubmitting(true);
    try {
      // On success, `AuthProvider`'s `onAuthStateChange` flips `status` and the root layout's
      // guard navigates — this screen does nothing further itself.
      const result = await signInWithEmail(trimmedEmail, password);
      if (!result.ok) {
        showError(t(result.error));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Screen
        title={t('auth.signIn.title')}
        chrome="none"
        headerAccessory={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('auth.back')}
            hitSlop={8}
            style={styles.backButton}
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace('/welcome');
              }
            }}
          >
            <ChevronLeft size={22} color={colors.ink} />
          </Pressable>
        }
        cta={{
          primary: {
            label: t('auth.signIn.cta'),
            tone: 'commit',
            onPress: () => {
              void handleSignIn();
            },
            disabled: submitting,
          },
        }}
      >
        <Text style={styles.subtitle}>{t('auth.signIn.subtitle')}</Text>

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
          testID="sign-in-email"
        />
        <TextField
          ref={passwordRef}
          label={t('auth.field.password')}
          placeholder={t('auth.field.passwordPlaceholder')}
          showLabel={false}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          textContentType="password"
          returnKeyType="done"
          onSubmitEditing={() => {
            void handleSignIn();
          }}
          error={error}
          testID="sign-in-password"
        />

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
              router.replace('/welcome');
            }}
          >
            {t('auth.signIn.noAccount')}
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
});
