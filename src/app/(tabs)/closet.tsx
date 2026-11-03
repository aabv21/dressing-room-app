import { StyleSheet, Text } from 'react-native';

import { useI18n } from '../../i18n';
import { Screen } from '../../ui/Screen';
import { colors } from '../../ui/theme';

// NOTE: placeholder content; the real closet grid, filters and empty state ship in Task 6.
export default function ClosetScreen() {
  const { t } = useI18n();
  return (
    <Screen title={t('screen.closet')}>
      <Text style={styles.comingSoon}>{t('comingSoon')}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  comingSoon: {
    color: colors.muted,
  },
});
