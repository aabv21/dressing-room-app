import { StyleSheet, Text } from 'react-native';

import { signOut } from '../../auth/authService';
import { useI18n } from '../../i18n';
import { Screen } from '../../ui/Screen';
import { colors } from '../../ui/theme';

// TEMP: a bare sign-out link until Task 7 builds the real Profile screen (settings, sign-out
// button styled per the mockups, etc.) — see task-5-brief.md's Step 3. `AuthProvider`'s
// `onAuthStateChange` reacts to the resulting SIGNED_OUT event and the root guard navigates back
// to (auth); this screen does nothing further itself.
export default function ProfileScreen() {
  const { t } = useI18n();
  return (
    <Screen title={t('screen.profile')}>
      <Text style={styles.comingSoon}>{t('comingSoon')}</Text>
      <Text
        accessibilityRole="link"
        style={styles.signOut}
        onPress={() => {
          void signOut();
        }}
      >
        {t('auth.signOut')}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  comingSoon: {
    color: colors.muted,
  },
  signOut: {
    color: colors.accent,
    fontWeight: '700',
    fontSize: 14,
  },
});
