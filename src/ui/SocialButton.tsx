import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../i18n';
import { colors, layout, radii } from './theme';

/**
 * Apple's guideline (and mockup 03's pin 2) requires offering "Continue with Apple" whenever
 * Google sign-in is offered on iOS; Android has no native Apple button, so it's hidden there
 * entirely rather than rendered disabled.
 *
 * Apple uses `AppleAuthentication.AppleAuthenticationButton`, not a custom button styled like the
 * Google one. A custom button only satisfies Apple's Human Interface Guidelines if it reproduces
 * their exact logo asset, approved title strings, and proportions, and a hand-traced path risks
 * getting those wrong in ways that are easy to miss in review. App Review safety wins over exact
 * mockup fidelity here: the native button is
 * automatically Apple-approved, accessible, and localizes via the device's own language list —
 * `app.json`'s `expo-localization` `supportedLocales: ["en", "es"]` makes that list (and thus
 * `CFBundleLocalizations`) include Spanish, so the button's text follows the *device* language.
 * Known, accepted deviation from an exact pixel match with the Google button: the native button's
 * label uses Apple's own type size/weight (not this app's 14pt/700), and it reads the device
 * locale rather than this app's in-app `LanguageToggle` preference.
 */
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
    height: layout.ctaHeight,
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
  googleLabel: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
});
