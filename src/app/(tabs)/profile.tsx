import { StyleSheet, Text } from 'react-native';

import { useI18n } from '../../i18n';
import { Screen } from '../../ui/Screen';
import { colors } from '../../ui/theme';

export default function ProfileScreen() {
  const { t } = useI18n();
  return (
    <Screen title={t('screen.profile')}>
      <Text style={styles.comingSoon}>{t('comingSoon')}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  comingSoon: {
    color: colors.muted,
  },
});
