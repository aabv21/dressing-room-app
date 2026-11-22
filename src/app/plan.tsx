// The planner: pick a day in the next 14, then an outfit from Saved, Today's suggestions or Build, and
// plan it (one per day). Pushed from Today; Build sends its outfit back as `?day=&ids=`.
import { router, useLocalSearchParams } from 'expo-router';
import { CalendarCheck, Layers, WifiOff } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { MIN_OUTFIT_PIECES, slotOf, type Occasion } from '../closet/catalog';
import { useCloset } from '../closet/ClosetProvider';
import type { Garment } from '../closet/garmentRepository';
import { useI18n } from '../i18n';
import { localDate } from '../lib/localDate';
import type { RequestError } from '../lib/requestResult';
import { OutfitStack } from '../outfits/OutfitStack';
import { storedLuckyOutfits } from '../outfits/storedLucky';
import { useSavedOutfits } from '../outfits/useSavedOutfits';
import { PlanDayStrip } from '../planner/PlanDayStrip';
import { formatPlanDay, planDays, planFor, usePlans } from '../planner/planCache';
import { deletePlan, refreshPlans, savePlan } from '../planner/planStore';
import { isCompleteOutfit } from '../../supabase/functions/_shared/outfitRules.ts';
import { announceForAccessibility } from '../ui/a11y';
import { ActionNotice } from '../ui/ActionNotice';
import { BackChevron } from '../ui/BackChevron';
import { ChipGroup } from '../ui/ChipGroup';
import { androidRipple } from '../ui/feedback';
import { Screen } from '../ui/Screen';
import { colors, fontSizes, layout, radii, spacing } from '../ui/theme';

type Choice = { garmentIds: string[]; occasion: Occasion | null };
type Source = 'saved' | 'suggestions';

const MINI_HEIGHT = 32;
const MINI_SLOP = (layout.minHitTarget - MINI_HEIGHT) / 2;

/** The ids still in the closet, when they still make a complete outfit; null otherwise. */
function presentOutfit(garmentIds: readonly string[], byId: ReadonlyMap<string, Garment>): string[] | null {
  const pieces = garmentIds.flatMap((id) => byId.get(id) ?? []);
  const slots = pieces.flatMap((garment) => (garment.category === null ? [] : [slotOf(garment.category)]));
  return pieces.length >= MIN_OUTFIT_PIECES && isCompleteOutfit(slots) ? pieces.map((garment) => garment.id) : null;
}

const sameOutfit = (a: readonly string[], b: readonly string[]): boolean => [...a].sort().join(',') === [...b].sort().join(',');

function MiniButton({ label, onPress, selected = false }: { label: string; onPress: () => void; selected?: boolean }): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      hitSlop={MINI_SLOP}
      onPress={onPress}
      android_ripple={androidRipple}
      style={[styles.mini, selected ? styles.miniSelected : null]}
    >
      <Text style={[styles.miniText, selected ? styles.miniTextSelected : null]}>{label}</Text>
    </Pressable>
  );
}

export default function PlanScreen(): React.JSX.Element {
  const { t, locale } = useI18n();
  const { userId } = useAuth();
  const { garments, thumbUrls } = useCloset();
  const params = useLocalSearchParams<{ day?: string; ids?: string }>();
  const today = localDate();
  const days = useMemo(() => planDays(today), [today]);
  const plans = usePlans(userId);
  const byId = useMemo(() => new Map(garments.map((garment) => [garment.id, garment])), [garments]);

  // A link from Build: its day when inside the window, and its outfit when the closet still has it.
  const [selected, setSelected] = useState(() => (typeof params.day === 'string' && days.includes(params.day) ? params.day : today));
  const [pending, setPending] = useState<Choice | null>(() => {
    if (typeof params.day !== 'string' || !days.includes(params.day) || typeof params.ids !== 'string') return null;
    const ids = presentOutfit(params.ids.split(','), byId);
    return ids === null ? null : { garmentIds: ids, occasion: null };
  });
  const [source, setSource] = useState<Source>('saved');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RequestError | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (userId === null) return;
    void refreshPlans(userId, today).then((ok) => {
      setOffline(!ok);
    });
  }, [userId, today]);

  const saved = useSavedOutfits(source === 'saved');
  const choices = useMemo<Choice[]>(() => {
    const raw =
      source === 'saved'
        ? (saved.saved ?? []).map((outfit) => ({ garmentIds: outfit.garmentIds, occasion: null }))
        : userId === null
          ? []
          : storedLuckyOutfits(userId, today);
    return raw.flatMap((choice) => {
      const ids = presentOutfit(choice.garmentIds, byId);
      return ids === null ? [] : [{ garmentIds: ids, occasion: choice.occasion }];
    });
  }, [source, saved.saved, userId, today, byId]);

  const planned = useMemo(() => new Set(plans.map((plan) => plan.day)), [plans]);
  const dayPlan = planFor(plans, selected);
  const dayLabel = formatPlanDay(locale, selected);
  const piecesOf = (ids: readonly string[]): Garment[] => ids.flatMap((id) => byId.get(id) ?? []);

  async function save(choice: Choice): Promise<void> {
    if (userId === null) return;
    setBusy(true);
    setError(null);
    const result = await savePlan(userId, { day: selected, garmentIds: choice.garmentIds, occasion: choice.occasion });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPending(null);
    announceForAccessibility(t('plan.done', { day: dayLabel }));
  }

  async function remove(): Promise<void> {
    if (userId === null || dayPlan === null) return;
    setBusy(true);
    setError(null);
    const result = await deletePlan(userId, dayPlan);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    announceForAccessibility(t('plan.removed'));
  }

  const cta =
    pending === null
      ? undefined
      : {
          primary: {
            label: t('plan.save', { day: dayLabel }),
            tone: 'commit' as const,
            icon: CalendarCheck,
            disabled: busy,
            onPress: () => {
              void save(pending);
            },
          },
          ...(error === null ? {} : { notice: <ActionNotice tone="error">{t(`plan.error.${error}`)}</ActionNotice> }),
        };

  return (
    <Screen
      title={t('plan.title')}
      chrome="none"
      headerAccessory={
        <BackChevron
          label={t('plan.back')}
          onPress={() => {
            router.back();
          }}
        />
      }
      {...(cta === undefined ? {} : { cta })}
    >
      {offline ? (
        <View style={styles.offline} accessibilityLiveRegion="polite">
          <WifiOff size={13} color={colors.muted} />
          <Text style={styles.muted}>{t('plan.offline')}</Text>
        </View>
      ) : null}
      <PlanDayStrip
        days={days}
        selected={selected}
        planned={planned}
        onSelect={(day) => {
          setSelected(day);
          setError(null);
        }}
      />

      {pending !== null ? (
        <View style={styles.card} testID="pending-outfit">
          <Text style={styles.cardTitle}>{t('plan.chosen')}</Text>
          <OutfitStack garments={piecesOf(pending.garmentIds)} thumbUrls={thumbUrls} compact />
        </View>
      ) : dayPlan !== null ? (
        <View style={styles.card} testID="day-plan">
          <Text style={styles.cardTitle} accessibilityRole="header">
            {t('plan.planned', { day: dayLabel })}
          </Text>
          <OutfitStack garments={piecesOf(dayPlan.garmentIds)} thumbUrls={thumbUrls} compact />
          <View style={styles.cardFooter}>
            <MiniButton
              label={t('plan.remove')}
              onPress={() => {
                void remove();
              }}
            />
          </View>
          {error === null ? null : <ActionNotice tone="error">{t(`plan.error.${error}`)}</ActionNotice>}
        </View>
      ) : (
        <Text style={styles.empty}>{t('plan.empty', { day: dayLabel })}</Text>
      )}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {t('plan.choose')}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            router.navigate({ pathname: '/build', params: { planFor: selected } });
          }}
          android_ripple={androidRipple}
          style={styles.build}
        >
          <Layers size={15} color={colors.accentText} />
          <Text style={styles.buildText}>{t('plan.build')}</Text>
        </Pressable>
      </View>
      <ChipGroup
        multiple={false}
        accessibilityLabel={t('plan.sources')}
        options={[
          { value: 'saved' as const, label: t('plan.source.saved') },
          { value: 'suggestions' as const, label: t('plan.source.suggestions') },
        ]}
        selected={[source]}
        onChange={([next]) => {
          // Tapping the chosen chip clears a single-select group; the source stays.
          if (next !== undefined) setSource(next);
        }}
      />
      {choices.length === 0 ? (
        <Text style={styles.muted}>
          {source === 'saved' ? (saved.saved === null ? '' : t('plan.saved.empty')) : t('plan.suggestions.empty')}
        </Text>
      ) : (
        choices.map((choice) => {
          const chosen = pending !== null && sameOutfit(pending.garmentIds, choice.garmentIds);
          return (
            <View key={choice.garmentIds.join(',')} style={[styles.card, chosen ? styles.cardChosen : null]}>
              <OutfitStack garments={piecesOf(choice.garmentIds)} thumbUrls={thumbUrls} compact />
              <View style={styles.cardFooter}>
                <MiniButton
                  label={t('plan.use')}
                  selected={chosen}
                  onPress={() => {
                    setPending(choice);
                    setError(null);
                  }}
                />
              </View>
            </View>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  muted: {
    flexShrink: 1,
    color: colors.muted,
    fontSize: fontSizes.bodySmall,
  },
  empty: {
    color: colors.inkSoft,
    fontSize: fontSizes.body,
    paddingVertical: spacing.sm,
  },
  card: {
    backgroundColor: colors.glass[75],
    borderWidth: 1,
    borderColor: colors.glass[95],
    borderRadius: radii.card,
    padding: 10,
    gap: spacing.sm - 2,
  },
  cardChosen: {
    borderColor: colors.selected,
  },
  cardTitle: {
    color: colors.accentText,
    fontSize: fontSizes.bodySmall,
    fontWeight: '700',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  sectionHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: fontSizes.title,
    fontWeight: '800',
  },
  build: {
    minHeight: layout.minHitTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.surface,
  },
  buildText: {
    color: colors.accentText,
    fontSize: fontSizes.bodySmall,
    fontWeight: '700',
  },
  mini: {
    minHeight: MINI_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.surface,
  },
  miniSelected: {
    backgroundColor: colors.selected,
    borderColor: colors.selected,
  },
  miniText: {
    color: colors.accentText,
    fontSize: fontSizes.bodySmall,
    fontWeight: '700',
  },
  miniTextSelected: {
    color: colors.onFill,
  },
});
