import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../i18n';
import { colors, layout, radii } from './theme';

// Apple requires "Continue with Apple" wherever Google sign-in is offered on iOS; Android has no
// native Apple button, so it's hidden there. Apple's native button, not a custom one: it's
// App Review-safe (exact logo, titles, proportions) and accessible. Accepted deviation: it uses
// Apple's type size/weight and follows the device language (`supportedLocales` in `app.json`), not
// the in-app `LanguageToggle`.
export function SocialButton(props: {
  provider: 'apple' | 'google';
  onPress: () => void;
  disabled?: boolean;
}): React.JSX.Element | null {
  const { provider, onPress, disabled = false } = props;
  const { t } = useI18n();

  if (provider === 'apple') {
    if (Platform.OS !== 'ios') {
      return null;
    }
    return (
      <View style={disabled ? styles.disabled : null} pointerEvents={disabled ? 'none' : 'auto'}>
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={radii.pill}
          style={styles.appleButton}
          onPress={onPress}
        />
      </View>
    );
  }

  const label = t('auth.social.google');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, styles.googleButton, disabled ? styles.disabled : null]}
    >
      <View style={styles.row}>
        <Text style={styles.googleGlyph}>G</Text>
        <Text style={styles.googleLabel}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: layout.ctaHeight,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appleButton: {
    height: layout.ctaHeight,
    width: '100%',
  },
  googleButton: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  disabled: {
    opacity: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  googleGlyph: {
    fontWeight: '800',
    fontSize: 15,
    color: colors.ink,
  },
  // Wraps inside the pill at large text sizes instead of spilling past its edges.
  googleLabel: {
    flexShrink: 1,
    textAlign: 'center',
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
});
