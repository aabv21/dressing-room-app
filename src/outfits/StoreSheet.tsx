// For you's "Search in stores" sheet: the stores for the device's region (`storeLinksFor`), each
// opening its search in the browser.
import { ExternalLink } from 'lucide-react-native';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useI18n } from '../i18n';
import { BottomSheet } from '../ui/BottomSheet';
import { colors, fontSizes, layout, radii, spacing } from '../ui/theme';
import type { StoreLink } from './storeLinks';

const BUTTON_HEIGHT = 48;

export function StoreSheet({
  visible,
  piece,
  links,
  onPick,
  onClose,
}: {
  visible: boolean;
  piece: string;
  links: readonly StoreLink[];
  onPick: (link: StoreLink) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <BottomSheet visible={visible} title={t('forYou.search')} subtitle={piece} onClose={onClose} testID="store-sheet">
      {links.map((link) => (
        <Pressable
          key={link.id}
          accessibilityRole="button"
          accessibilityLabel={link.name}
          accessibilityHint={t('forYou.stores.hint')}
          onPress={() => {
            onPick(link);
          }}
          style={({ pressed }) => [styles.store, pressed ? styles.pressed : null]}
        >
          <Text style={styles.storeLabel}>{link.name}</Text>
          <ExternalLink size={16} color={colors.accentText} />
        </Pressable>
      ))}
      <Pressable accessibilityRole="button" accessibilityLabel={t('forYou.stores.cancel')} onPress={onClose} style={styles.cancel}>
        <Text style={styles.cancelLabel}>{t('forYou.stores.cancel')}</Text>
      </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  store: {
    minHeight: BUTTON_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.surface,
  },
  pressed: {
    backgroundColor: colors.tint,
  },
  storeLabel: {
    color: colors.ink,
    fontSize: fontSizes.body,
    fontWeight: '700',
  },
  cancel: {
    minHeight: layout.minHitTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelLabel: {
    color: colors.muted,
    fontSize: fontSizes.body,
    fontWeight: '700',
  },
});
