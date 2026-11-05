import { StyleSheet, Text } from 'react-native';

import { useI18n } from '../../i18n';
import { Screen } from '../../ui/Screen';
import { colors } from '../../ui/theme';

// NOTE: placeholder onboarding screen; Task 6 replaces this with the clothing/body/style step flow.
export default function OnboardingPlaceholderScreen() {
  const { t } = useI18n();
  return (
    <Screen title={t('screen.profile')} chrome="none">
      <Text style={styles.comingSoon}>{t('comingSoon')}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  comingSoon: {
    color: colors.muted,
  },
});
