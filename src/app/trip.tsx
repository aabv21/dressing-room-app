// "Pack for a trip": a city (typed or dictated), the dates and an occasion, then each day's outfit and
// a packing list with check-offs (docs/app.md#trips-srctrips). Pushed from Today.
import { router } from 'expo-router';
import { CloudOff, Luggage, MapPin, Plus, Square, SquareCheck } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { OCCASIONS, type Occasion } from '../closet/catalog';
import { useCloset } from '../closet/ClosetProvider';
import type { Garment } from '../closet/garmentRepository';
import { pluralKey, useI18n } from '../i18n';
import { localDate } from '../lib/localDate';
import type { RequestError } from '../lib/requestResult';
import type { AiError } from '../outfits/aiClient';
import { formatWeather, pieceLabel } from '../outfits/outfitDisplay';
import { OutfitStack } from '../outfits/OutfitStack';
import { formatPlanDay } from '../planner/planCache';
import { PlanDayStrip } from '../planner/PlanDayStrip';
import { addDays } from '../stats/periods';
import { deleteSavedTrip, listSavedTrips, saveTrip, type SavedTrip } from '../trips/savedTrips';
import { toggleChecked, tripKey, useTripChecks } from '../trips/tripChecks';
import { planTripRequest, type TripResponse } from '../trips/tripClient';
import { announceForAccessibility } from '../ui/a11y';
import { ActionNotice } from '../ui/ActionNotice';
import type { CtaAction } from '../ui/AnchoredCta';
import { BackChevron } from '../ui/BackChevron';
import { ChipGroup } from '../ui/ChipGroup';
import { androidRipple, tapHaptic } from '../ui/feedback';
import { Screen } from '../ui/Screen';
import { TextField } from '../ui/TextField';
import { colors, fontSizes, layout, radii, spacing } from '../ui/theme';
import { useDictation } from '../voice/dictation';
import { MicButton } from '../voice/MicButton';

/** How far ahead the start can be picked; `trip-plan` itself allows a year. */
const START_DAYS = 60;
const MAX_TRIP_DAYS = 10;
const LENGTHS = Array.from({ length: MAX_TRIP_DAYS }, (_, n) => String(n + 1));

type Trip = { city: string; start: string; end: string; occasion: Occasion | null };
type Ok = Extract<TripResponse, { kind: 'ok' }>;
type Shown = { trip: Trip; result: TripResponse; savedId: string | null };

function PackingList({ trip, result, byId }: { trip: Trip; result: Ok; byId: ReadonlyMap<string, Garment> }): React.JSX.Element {
  const { t } = useI18n();
  const { userId } = useAuth();
  const key = tripKey(trip);
  const checked = useTripChecks(userId, key);
  return (
    <View style={styles.card} testID="trip-packing">
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {t('trip.packing')}
      </Text>
      {result.packing.map((group) => (
        <View key={group.slot} style={styles.group}>
          <Text style={styles.groupTitle}>{t('trip.group', { slot: t(`trip.slot.${group.slot}`), count: group.items.length })}</Text>
          {group.items.flatMap((item) => {
            const garment = byId.get(item.garmentId);
            if (garment === undefined) return [];
            const isChecked = checked.has(item.garmentId);
            const label = t(pluralKey('trip.item', item.days), { piece: pieceLabel(garment, t), count: item.days });
            const Box = isChecked ? SquareCheck : Square;
            return [
              <Pressable
                key={item.garmentId}
                accessibilityRole="checkbox"
                accessibilityLabel={label}
                accessibilityState={{ checked: isChecked }}
                onPress={() => {
                  tapHaptic('selection');
                  if (userId !== null) toggleChecked(userId, key, item.garmentId);
                }}
                android_ripple={androidRipple}
                style={styles.item}
              >
                <Box size={20} color={isChecked ? colors.accentText : colors.muted} />
                <Text style={[styles.itemText, isChecked ? styles.itemDone : null]}>{label}</Text>
              </Pressable>,
            ];
          })}
        </View>
      ))}
    </View>
  );
}

export default function TripScreen(): React.JSX.Element {
  const { t, locale } = useI18n();
  const { garments, thumbUrls } = useCloset();
  const byId = useMemo(() => new Map(garments.map((garment) => [garment.id, garment])), [garments]);
  const today = localDate();
  const startDays = useMemo(() => Array.from({ length: START_DAYS }, (_, n) => addDays(today, n)), [today]);

  const [city, setCity] = useState('');
  const [start, setStart] = useState(today);
  const [length, setLength] = useState(3);
  const [occasion, setOccasion] = useState<Occasion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AiError | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<RequestError | null>(null);
  const [saved, setSaved] = useState<SavedTrip[]>([]);

  const dictation = useDictation((text) => {
    setCity(text);
    setError(null);
  });

  useEffect(() => {
    let current = true;
    listSavedTrips().then(
      (trips) => {
        if (current) setSaved(trips);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, []);

  const tripLabel = (trip: Trip): string =>
    `${trip.city}, ${t('trip.savedRange', { start: formatPlanDay(locale, trip.start), end: formatPlanDay(locale, trip.end) })}`;

  async function plan(): Promise<void> {
    const trip: Trip = { city: city.trim(), start, end: addDays(start, length - 1), occasion };
    setBusy(true);
    setError(null);
    const outcome = await planTripRequest({ ...trip, language: locale, date: today });
    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.error);
      announceForAccessibility(t(`trip.error.${outcome.error}`));
      return;
    }
    setShown({ trip, result: outcome.result, savedId: null });
    setSaveError(null);
  }

  async function save(current: Shown): Promise<void> {
    setSaving(true);
    setSaveError(null);
    const result = await saveTrip({ ...current.trip, result: current.result });
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    setShown({ ...current, savedId: result.trip.id });
    setSaved((trips) => [result.trip, ...trips]);
  }

  async function remove(trip: SavedTrip): Promise<void> {
    const result = await deleteSavedTrip(trip.id);
    if (result.ok) setSaved((trips) => trips.filter((entry) => entry.id !== trip.id));
  }

  let cta: { primary: CtaAction; secondary?: CtaAction; notice?: React.ReactNode };
  if (shown === null) {
    cta = {
      primary: {
        label: t('trip.plan'),
        tone: 'commit',
        icon: Luggage,
        disabled: busy || city.trim() === '',
        onPress: () => {
          void plan();
        },
      },
    };
  } else {
    const current = shown;
    cta = {
      primary: {
        label: current.savedId === null ? t('trip.save') : t('trip.saved'),
        tone: 'commit',
        disabled: saving || current.savedId !== null || current.result.kind !== 'ok',
        onPress: () => {
          void save(current);
        },
      },
      secondary: {
        label: t('trip.new'),
        tone: 'ghost',
        icon: Plus,
        onPress: () => {
          setShown(null);
        },
      },
      ...(saveError === null ? {} : { notice: <ActionNotice tone="error">{t(`trip.saveError.${saveError}`)}</ActionNotice> }),
    };
  }

  let body: React.ReactNode;
  if (shown === null) {
    body = (
      <>
        <TextField
          label={t('trip.city')}
          placeholder={t('trip.cityPlaceholder')}
          value={city}
          onChangeText={(next) => {
            setCity(next);
            setError(null);
          }}
          autoCapitalize="words"
          textContentType="addressCity"
          maxLength={100}
          returnKeyType="done"
          testID="trip-city"
          leading={<MapPin size={16} color={colors.accentText} />}
          trailing={<MicButton dictation={dictation} label={t('dictate.city')} size={32} />}
        />
        {dictation.problem === null ? null : (
          <Text style={styles.muted} accessibilityLiveRegion="polite">
            {dictation.problem === 'denied' ? t('dictate.denied') : dictation.problem === 'failed' ? t('dictate.failed') : t('dictate.noMatch')}
          </Text>
        )}
        <Text style={styles.label}>{t('trip.start')}</Text>
        <PlanDayStrip days={startDays} selected={start} planned={new Set()} onSelect={setStart} label={t('trip.start')} />
        <Text style={styles.label}>{t('trip.length')}</Text>
        <ChipGroup
          multiple={false}
          accessibilityLabel={t('trip.length')}
          options={LENGTHS.map((value) => ({ value, label: t(pluralKey('trip.days', Number(value)), { count: value }) }))}
          selected={[String(length)]}
          onChange={([next]) => {
            if (next !== undefined) setLength(Number(next));
          }}
        />
        <Text style={styles.label}>{t('trip.occasion')}</Text>
        <ChipGroup
          multiple={false}
          accessibilityLabel={t('trip.occasion')}
          options={OCCASIONS.map((value) => ({ value, label: t(`occasion.${value}`) }))}
          selected={occasion === null ? [] : [occasion]}
          onChange={([next]: Occasion[]) => {
            setOccasion(next ?? null);
          }}
        />
        {busy ? (
          <View style={styles.loading} accessible accessibilityLabel={t('trip.loading')} accessibilityLiveRegion="polite">
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.muted}>{t('trip.loading')}</Text>
          </View>
        ) : null}
        {error === null ? null : (
          <Text style={styles.error} accessibilityRole="alert">
            {t(`trip.error.${error}`)}
          </Text>
        )}
        {saved.length === 0 ? null : (
          <View style={styles.saved}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              {t('trip.savedTrips')}
            </Text>
            {saved.map((trip) => (
              <View key={trip.id} style={styles.savedRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('trip.open', { trip: tripLabel(trip) })}
                  onPress={() => {
                    setShown({ trip, result: trip.result, savedId: trip.id });
                  }}
                  style={styles.savedOpen}
                >
                  <Text style={styles.savedText}>{tripLabel(trip)}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('trip.delete', { trip: tripLabel(trip) })}
                  onPress={() => {
                    void remove(trip);
                  }}
                  style={styles.savedDelete}
                >
                  <Text style={styles.deleteText}>{t('trip.deleteShort')}</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </>
    );
  } else if (shown.result.kind === 'too_small') {
    const slots = shown.result.missing.map((slot) => t(`today.missing.${slot}`)).join(', ');
    body = (
      <Text style={styles.error} accessibilityRole="alert">
        {t('trip.tooSmall', { slots })}
      </Text>
    );
  } else {
    const result = shown.result;
    body = (
      <>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {t('trip.result', { city: result.city })}
        </Text>
        {result.days.map((day) => {
          const date = new Date(`${day.date}T12:00:00`);
          const pieces = (day.garmentIds ?? []).flatMap((id) => byId.get(id) ?? []);
          return (
            <View key={day.date} style={styles.card} testID={`trip-day-${day.date}`}>
              <Text style={styles.groupTitle}>{formatPlanDay(locale, day.date)}</Text>
              {day.weather === null ? (
                <View style={styles.row}>
                  <CloudOff size={13} color={colors.muted} />
                  <Text style={styles.muted}>{t('trip.noForecast')}</Text>
                </View>
              ) : (
                <Text style={styles.muted}>{formatWeather(day.weather, locale, date)}</Text>
              )}
              {pieces.length === 0 ? (
                <Text style={styles.muted}>{t('trip.noOutfit')}</Text>
              ) : (
                <OutfitStack garments={pieces} thumbUrls={thumbUrls} compact />
              )}
            </View>
          );
        })}
        <PackingList trip={shown.trip} result={result} byId={byId} />
      </>
    );
  }

  return (
    <Screen
      title={t('trip.title')}
      chrome="none"
      headerAccessory={
        <BackChevron
          label={t('trip.back')}
          onPress={() => {
            router.back();
          }}
        />
      }
      cta={cta}
    >
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: {
    color: colors.muted,
    fontSize: fontSizes.bodySmall,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
  muted: {
    flexShrink: 1,
    color: colors.muted,
    fontSize: fontSizes.bodySmall,
  },
  error: {
    color: colors.error,
    fontSize: fontSizes.body,
  },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  card: {
    backgroundColor: colors.glass[75],
    borderWidth: 1,
    borderColor: colors.glass[95],
    borderRadius: radii.card,
    padding: 10,
    gap: spacing.sm - 2,
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: fontSizes.title,
    fontWeight: '800',
  },
  group: {
    gap: 2,
  },
  groupTitle: {
    color: colors.accentText,
    fontSize: fontSizes.bodySmall,
    fontWeight: '700',
  },
  item: {
    minHeight: layout.minHitTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  itemText: {
    flexShrink: 1,
    color: colors.ink,
    fontSize: fontSizes.body,
  },
  itemDone: {
    color: colors.muted,
    textDecorationLine: 'line-through',
  },
  saved: {
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  savedOpen: {
    flex: 1,
    minHeight: layout.minHitTarget,
    justifyContent: 'center',
  },
  savedText: {
    color: colors.accentText,
    fontSize: fontSizes.body,
    fontWeight: '700',
  },
  savedDelete: {
    minHeight: layout.minHitTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  deleteText: {
    color: colors.error,
    fontSize: fontSizes.bodySmall,
    fontWeight: '700',
  },
});
