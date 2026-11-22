// "Share": the outfit's card in a sheet, with "Share image" capturing it and opening the share sheet.
// A failure stays here as a message.
import { Share2 } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, type ViewInstance } from 'react-native';

import type { Garment } from '../closet/garmentRepository';
import { useI18n, type MessageKey } from '../i18n';
import { announceForAccessibility } from '../ui/a11y';
import { BottomSheet } from '../ui/BottomSheet';
import { colors, fontSizes, layout, radii, spacing } from '../ui/theme';
import { ShareCard } from './ShareCard';
import { shareOutfitImage } from './shareOutfit';

const BUTTON_HEIGHT = 48;

/** How long "Share image" waits for the thumbnails before allowing a capture anyway. */
export const IMAGE_WAIT_MS = 3000;

type SheetProps = {
  visible: boolean;
  garments: readonly Garment[];
  thumbUrls: Map<string, string>;
  score: number | null;
  onClose: () => void;
};

/**
 * The sheet's content, mounted each time the sheet opens (a hidden `Modal` renders nothing), so the
 * thumbnail wait starts over. The capture targets the card itself, never the scroll viewport, so a
 * look taller than the screen is still captured whole.
 */
function ShareSheetBody({ garments, thumbUrls, score, onClose }: Omit<SheetProps, 'visible'>): React.JSX.Element {
  const { t } = useI18n();
  const card = useRef<ViewInstance>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);

  // A capture before the thumbnails draw would share an empty card.
  const [settled, setSettled] = useState<ReadonlySet<string>>(() => new Set());
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setTimedOut(true);
    }, IMAGE_WAIT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, []);
  const settle = useCallback((garmentId: string) => {
    setSettled((current) => (current.has(garmentId) ? current : new Set(current).add(garmentId)));
  }, []);
  const ready = timedOut || garments.every((g) => !thumbUrls.has(g.id) || settled.has(g.id));
  const disabled = busy || !ready;

  const share = useCallback(async () => {
    setBusy(true);
    setError(null);
    const outcome = await shareOutfitImage(card, t('share.title'));
    setBusy(false);
    if (outcome === 'shared') {
      onClose();
      return;
    }
    const message: MessageKey = outcome === 'unavailable' ? 'share.unavailable' : 'share.error';
    setError(message);
    announceForAccessibility(t(message));
  }, [t, onClose]);

  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} testID="share-sheet-scroll">
        <ShareCard ref={card} garments={garments} thumbUrls={thumbUrls} score={score} onImageSettled={settle} />
      </ScrollView>
      {error === null ? null : (
        <Text style={styles.error} accessibilityRole="alert">
          {t(error)}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('share.send')}
        accessibilityState={{ disabled, busy }}
        disabled={disabled}
        onPress={() => {
          void share();
        }}
        style={[styles.send, disabled ? styles.dimmed : null]}
      >
        <Share2 size={16} color={colors.onFill} />
        <Text style={styles.sendLabel}>{t('share.send')}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('share.close')} onPress={onClose} style={styles.close}>
        <Text style={styles.closeLabel}>{t('share.close')}</Text>
      </Pressable>
    </>
  );
}

export function ShareOutfitSheet({ visible, garments, thumbUrls, score, onClose }: SheetProps): React.JSX.Element {
  const { t } = useI18n();
  return (
    <BottomSheet visible={visible} title={t('share.title')} onClose={onClose} testID="share-sheet">
      {visible ? <ShareSheetBody garments={garments} thumbUrls={thumbUrls} score={score} onClose={onClose} /> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  scrollContent: {
    paddingVertical: spacing.xs,
  },
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
