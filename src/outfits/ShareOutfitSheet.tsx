// "Share": the outfit's card in a sheet, with "Share image" capturing it and opening the share sheet.
// A failure stays here as a message.
import { Share2 } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, type ViewInstance } from 'react-native';

import type { Garment } from '../closet/garmentRepository';
import { useI18n, type MessageKey } from '../i18n';
import { announceForAccessibility } from '../ui/a11y';
import { BottomSheet } from '../ui/BottomSheet';
import { colors, fontSizes, layout, radii, spacing } from '../ui/theme';
import { ShareCard } from './ShareCard';
import { shareOutfitImage } from './shareOutfit';

const BUTTON_HEIGHT = 48;

export function ShareOutfitSheet({
  visible,
  garments,
  thumbUrls,
  score,
  onClose,
}: {
  visible: boolean;
  garments: readonly Garment[];
  thumbUrls: Map<string, string>;
  score: number | null;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const card = useRef<ViewInstance>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);

  const close = useCallback(() => {
    setError(null);
    onClose();
  }, [onClose]);

  const share = useCallback(async () => {
    setBusy(true);
    setError(null);
    const outcome = await shareOutfitImage(card, t('share.title'));
    setBusy(false);
    if (outcome === 'shared') {
      close();
      return;
    }
    const message: MessageKey = outcome === 'unavailable' ? 'share.unavailable' : 'share.error';
    setError(message);
    announceForAccessibility(t(message));
  }, [t, close]);

  return (
    <BottomSheet visible={visible} title={t('share.title')} onClose={close} testID="share-sheet">
      <ShareCard ref={card} garments={garments} thumbUrls={thumbUrls} score={score} />
      {error === null ? null : (
        <Text style={styles.error} accessibilityRole="alert">
          {t(error)}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('share.send')}
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={() => {
          void share();
        }}
        style={[styles.send, busy ? styles.dimmed : null]}
      >
        <Share2 size={16} color={colors.onFill} />
        <Text style={styles.sendLabel}>{t('share.send')}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('share.close')} onPress={close} style={styles.close}>
        <Text style={styles.closeLabel}>{t('share.close')}</Text>
      </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  error: {
    color: colors.error,
    fontSize: fontSizes.bodySmall,
    textAlign: 'center',
  },
  send: {
    minHeight: BUTTON_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.commit,
  },
  sendLabel: {
    color: colors.onFill,
    fontSize: fontSizes.body,
    fontWeight: '700',
  },
  dimmed: {
    opacity: 0.5,
  },
  close: {
    minHeight: layout.minHitTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeLabel: {
    color: colors.muted,
    fontSize: fontSizes.body,
    fontWeight: '700',
  },
});
