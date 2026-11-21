// Today's "Planned for today": the plan's pieces still there and available, and its own "I'll wear it".
// A plan is never a wear by itself: only this tap logs one, through the shared `useWearLog`.
import { CalendarCheck, Check } from 'lucide-react-native';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { slotOf } from '../closet/catalog';
import type { Garment } from '../closet/garmentRepository';
import { useI18n } from '../i18n';
import { OutfitStack } from '../outfits/OutfitStack';
import type { WearLog } from '../outfits/useWearLog';
import { isCompleteOutfit } from '../../supabase/functions/_shared/outfitRules.ts';
import { ActionNotice, UndoNotice } from '../ui/ActionNotice';
import { androidRipple, tapHaptic } from '../ui/feedback';
import { colors, fontSizes, layout, radii, spacing } from '../ui/theme';
import type { PlannedOutfit } from './plannedOutfits';

/** The planned pieces that can be worn now, and whether they still make a complete outfit. */
export function wearablePieces(
  plan: PlannedOutfit,
  byId: ReadonlyMap<string, Garment>,
): { pieces: Garment[]; garmentIds: string[]; wearable: boolean } {
  const pieces = plan.garmentIds.flatMap((id) => {
    const garment = byId.get(id);
    return garment?.status === 'available' ? [garment] : [];
  });
  const slots = pieces.flatMap((garment) => (garment.category === null ? [] : [slotOf(garment.category)]));
  return { pieces, garmentIds: pieces.map((garment) => garment.id), wearable: isCompleteOutfit(slots) };
}

export function PlannedTodayCard({
  plan,
  byId,
  thumbUrls,
  wearLog,
}: {
  plan: PlannedOutfit;
  byId: ReadonlyMap<string, Garment>;
  thumbUrls: Map<string, string>;
  wearLog: WearLog;
}): React.JSX.Element {
  const { t } = useI18n();
  const { pieces, garmentIds, wearable } = useMemo(() => wearablePieces(plan, byId), [plan, byId]);
  const logged = wearLog.isLogged(garmentIds);
  const error = wearLog.errorFor(garmentIds);
  const disabled = logged || wearLog.busy || !wearable;
  return (
    <View style={styles.card} testID="planned-today">
      <View style={styles.header}>
        <CalendarCheck size={14} color={colors.accentText} />
        <Text style={styles.title} accessibilityRole="header">
          {t('today.planned')}
        </Text>
        {plan.occasion === null ? null : <Text style={styles.muted}>{t(`occasion.${plan.occasion}`)}</Text>}
      </View>
      <OutfitStack garments={pieces} thumbUrls={thumbUrls} compact />
      {wearable || logged ? null : <Text style={styles.muted}>{t('saved.unavailable')}</Text>}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={logged ? t('outfit.logged') : t('outfit.wear')}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => {
          tapHaptic('commit');
          void wearLog.log(garmentIds, plan.occasion, null);
        }}
        android_ripple={androidRipple}
        style={[styles.wear, disabled ? styles.dimmed : null]}
      >
        {logged ? null : <Check size={16} color={colors.onFill} />}
        <Text style={styles.wearLabel}>{logged ? t('outfit.logged') : t('outfit.wear')}</Text>
      </Pressable>
      {error === null ? null : <ActionNotice tone="error">{t(`outfit.error.${error}`)}</ActionNotice>}
      {wearLog.undoFailedFor(garmentIds) ? <ActionNotice tone="error">{t('outfit.undoFailed')}</ActionNotice> : null}
      {wearLog.isQueued(garmentIds) ? <ActionNotice tone="queued">{t('outfit.queued')}</ActionNotice> : null}
      {wearLog.canUndo(garmentIds) ? (
        <UndoNotice
          label={t('outfit.undo')}
          hint={t('outfit.undo.hint')}
          onPress={() => {
            void wearLog.undo(garmentIds);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.glass[75],
    borderWidth: 1,
    borderColor: colors.accentBorder,
    borderRadius: radii.card,
    padding: 10,
    gap: spacing.sm - 2,
  },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 5,
  },
  title: {
    flexShrink: 1,
    color: colors.accentText,
    fontSize: fontSizes.bodySmall,
    fontWeight: '700',
  },
  muted: {
    color: colors.muted,
    fontSize: fontSizes.bodySmall,
  },
  // An anchored-CTA-sized pill inside the card: Today's own anchored button stays the lucky outfit's.
  wear: {
    minHeight: layout.ctaHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    borderRadius: radii.pill,
    backgroundColor: colors.commit,
    paddingHorizontal: spacing.md,
  },
  wearLabel: {
    color: colors.onFill,
    fontSize: fontSizes.body,
    fontWeight: '700',
  },
  dimmed: {
    opacity: 0.4,
  },
});
