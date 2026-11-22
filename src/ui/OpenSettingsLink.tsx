// "Open settings" under a permission the user denied: the system's page for this app.
import { Linking, Pressable, StyleSheet, Text } from 'react-native';

import { useI18n } from '../i18n';
import { colors, fontSizes, layout } from './theme';

export function OpenSettingsLink(): React.JSX.Element {
  const { t } = useI18n();
  const label = t('settings.open');
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={() => {
        Linking.openSettings().catch(() => undefined);
      }}
      style={styles.link}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: {
    alignSelf: 'flex-start',
    minHeight: layout.minHitTarget,
    justifyContent: 'center',
  },
  label: {
    color: colors.accentText,
    fontSize: fontSizes.bodySmall,
    fontWeight: '700',
  },
});
