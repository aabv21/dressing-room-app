// Today (mockup 01 screen 1): the day's weather, an optional occasion, and the "feeling lucky"
// outfit with "Another" and "I'll wear it". The weather line opens the city modal; the card's
// "How does it look?" chip opens the rating.
import { randomUUID } from 'expo-crypto';
import { router, useIsFocused } from 'expo-router';
import { Check, Dices, RotateCw, Shirt, Shuffle, Sparkles } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../auth/AuthProvider';
import { OCCASIONS, type Occasion } from '../../closet/catalog';
import { useCloset } from '../../closet/ClosetProvider';
import { useI18n } from '../../i18n';
import type { RequestError } from '../../lib/requestResult';
import { logWear } from '../../outfits/outfitRepository';
import { formatWeather } from '../../outfits/outfitDisplay';
import { OutfitStack } from '../../outfits/OutfitStack';
import type { LuckyOutfit } from '../../outfits/types';
import { useLuckyList, useTodayOccasion } from '../../outfits/useLuckyList';
import { useWornToday } from '../../outfits/wornToday';
import { getProfile } from '../../profile/profileRepository';
import type { CtaAction } from '../../ui/AnchoredCta';
import { ChipGroup } from '../../ui/ChipGroup';
import { Screen } from '../../ui/Screen';
import { colors, layout, radii, spacing } from '../../ui/theme';

// Room for a message shown above the buttons, so it never covers the card's last row.
const NOTICE_ROOM = 56;
const CHIP_AI_HEIGHT = 28;
const WEATHER_LINE_HEIGHT = 18;
// The weather line is one short text row; the slop tops its tap area up to the 44 pt minimum.
const WEATHER_SLOP = (layout.minHitTarget - WEATHER_LINE_HEIGHT) / 2;

const outfitKey = (outfit: LuckyOutfit): string => outfit.garmentIds.join(',');

/**
 * The weather line under the title, which opens the city modal: the day's weather; with none, why
 * (a city that gave no weather) or a prompt to add one; nothing while it's unknown.
 */
function WeatherLine({ text, action }: { text: string | null; action: boolean }): React.JSX.Element {
  const { t } = useI18n();
  if (text === null) {
    // Keeps the line's height while the weather is unknown, so the card doesn't jump.
    return <View style={styles.weatherLine} />;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={t('today.weather.hint')}
      onPress={() => {
        router.push('/city');
      }}
      hitSlop={{ top: WEATHER_SLOP, bottom: WEATHER_SLOP, right: WEATHER_SLOP }}
      style={styles.weatherLine}
    >
      <Text style={[styles.weatherText, action ? styles.weatherAction : null]}>{text}</Text>
    </Pressable>
  );
}

/**
 * The profile's city name (null when there's none), read only while `needed` (the list came back
 * without weather) and again when the screen regains focus, e.g. after the city modal; `undefined`
 * until read. A failed read counts as no city, so the line still offers to set one.
 */
function useProfileCity(needed: boolean): string | null | undefined {
  const { userId } = useAuth();
  const focused = useIsFocused();
  const [city, setCity] = useState<{ userId: string; name: string | null } | null>(null);
  useEffect(() => {
    if (!needed || !focused || userId === null) return undefined;
    let current = true;
    getProfile(userId).then(
      (profile) => {
        const name = profile?.city_name?.trim() ?? '';
        if (current) setCity({ userId, name: name === '' ? null : name });
      },
      () => {
        if (current) setCity({ userId, name: null });
      },
    );
    return () => {
      current = false;
    };
  }, [needed, focused, userId]);
  return city !== null && city.userId === userId ? city.name : undefined;
}

function CardHeader({ onRate }: { onRate?: () => void }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <View style={styles.cardHeader}>
      <View style={styles.cardLabel}>
        <Dices size={14} color={colors.muted} />
        <Text style={styles.muted}>{t('today.lucky')}</Text>
      </View>
      {onRate === undefined ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('today.rate')}
          onPress={onRate}
          hitSlop={{ top: (layout.minHitTarget - CHIP_AI_HEIGHT) / 2, bottom: (layout.minHitTarget - CHIP_AI_HEIGHT) / 2 }}
          style={styles.chipAi}
        >
          <Sparkles size={11} color={colors.accentText} fill={colors.accentText} />
          <Text style={styles.chipAiLabel}>{t('today.rate')}</Text>
        </Pressable>
      )}
    </View>
  );
}

function LoadingCard(): React.JSX.Element {
  const { t } = useI18n();
  return (
    <View style={styles.card} accessible accessibilityLabel={t('today.loading')} accessibilityLiveRegion="polite">
      <CardHeader />
      {[0, 1, 2].map((row) => (
        <View key={row} style={styles.placeholderRow}>
          <View style={styles.placeholderThumb} />
          <View style={styles.placeholderText}>
            <View style={[styles.placeholderBar, styles.placeholderWide]} />
            <View style={styles.placeholderBar} />
          </View>
        </View>
      ))}
    </View>
  );
}

function Message({ children }: { children: string }): React.JSX.Element {
  return (
    <Text style={styles.message} accessibilityRole="alert">
      {children}
    </Text>
  );
}

/**
 * "I'll wear it" for Today's outfits, one at a time: the ref locks a second tap before the
 * re-render lands. Which outfits are logged comes from the shared worn-today record (the rating
 * screen writes it too); `wearError` is keyed by `<day>|<ids>`, so it belongs to the outfit it was
 * for.
 */
function useWearLog(
  day: string,
  occasion: Occasion | null,
): {
  pending: boolean;
  isLogged: (garmentIds: readonly string[]) => boolean;
  wearError: { key: string; error: RequestError } | null;
  setWearError: (next: null) => void;
  wear: (worn: LuckyOutfit, key: string) => Promise<void>;
} {
  const { t } = useI18n();
  const { refresh } = useCloset();
  // False once the screen is gone: a late wear result is dropped.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const { isWorn, markWorn } = useWornToday(day);
  const [wearError, setWearError] = useState<{ key: string; error: RequestError } | null>(null);
  // P4-R5: one id per outfit until its wear succeeds, kept across retries (also after trying another
  // outfit in between), so a lost response can't log it twice.
  const wearIds = useRef(new Map<string, string>());

  const wear = useCallback(
    async (worn: LuckyOutfit, key: string) => {
      if (busy.current) return;
      busy.current = true;
      setPending(true);
      setWearError(null);
      let id = wearIds.current.get(key);
      if (id === undefined) {
        id = randomUUID();
        wearIds.current.set(key, id);
      }
      const outcome = await logWear({ wearId: id, garmentIds: worn.garmentIds, wornOn: day, occasion, score: null });
      busy.current = false;
      if (!mounted.current) return;
      setPending(false);
      if (outcome.ok) {
        wearIds.current.delete(key);
        markWorn(worn.garmentIds);
        void refresh();
      } else {
        setWearError({ key, error: outcome.error });
        AccessibilityInfo.announceForAccessibility(t(`outfit.error.${outcome.error}`));
      }
    },
    [day, occasion, markWorn, refresh, t],
  );

  return { pending, isLogged: isWorn, wearError, setWearError, wear };
}

export default function TodayScreen(): React.JSX.Element {
  const { t, locale } = useI18n();
  const [occasion, setOccasion] = useTodayOccasion();
  const lucky = useLuckyList(occasion);
  const { garments, thumbUrls } = useCloset();
  const byId = useMemo(() => new Map(garments.map((garment) => [garment.id, garment])), [garments]);

  const outfit = lucky.state === 'ready' ? lucky.outfits[lucky.index] : undefined;
  const pieces = useMemo(() => outfit?.garmentIds.flatMap((id) => byId.get(id) ?? []) ?? [], [outfit, byId]);
  const shownKey = outfit === undefined ? null : `${lucky.day}|${outfitKey(outfit)}`;

  const { pending, isLogged, wearError, setWearError, wear } = useWearLog(lucky.day, occasion);

  const weatherResolved = lucky.state === 'ready' || lucky.state === 'too_small';
  const cityWithoutWeather = useProfileCity(weatherResolved && lucky.weather === null);
  let weatherText = formatWeather(lucky.weather, locale);
  if (weatherText === null && weatherResolved && cityWithoutWeather !== undefined) {
    weatherText =
      cityWithoutWeather === null
        ? t('today.weather.add')
        : t('today.weather.unavailable', { city: cityWithoutWeather });
  }

  const notice =
    wearError === null || wearError.key !== shownKey ? undefined : (
      <Text style={styles.actionError} accessibilityRole="alert">
        {t(`outfit.error.${wearError.error}`)}
      </Text>
    );

  let body: React.ReactNode;
  let primary: CtaAction | undefined;
  let secondary: CtaAction | undefined;
  if (lucky.state === 'loading') {
    body = <LoadingCard />;
  } else if (lucky.state === 'error') {
    const error = lucky.error ?? 'unknown';
    body = <Message>{t(`today.error.${error}`)}</Message>;
    // Over quota can't succeed again today, so there's no retry.
    if (error !== 'over_quota') {
      primary = { label: t('today.retry'), tone: 'commit', icon: RotateCw, onPress: lucky.reload };
    }
  } else if (lucky.state === 'too_small') {
    const slots = lucky.missing.map((slot) => t(`today.missing.${slot}`)).join(', ');
    body = <Message>{t('today.tooSmall', { n: lucky.missing.length, slots })}</Message>;
    primary = {
      label: t('today.tooSmall.cta'),
      tone: 'commit',
      icon: Shirt,
      onPress: () => {
        router.push('/closet');
      },
    };
  } else if (outfit === undefined || shownKey === null) {
    body = <Message>{occasion === null ? t('today.empty') : t('today.empty.occasion')}</Message>;
  } else {
    const logged = isLogged(outfit.garmentIds);
    body = (
      <View style={styles.card}>
        <CardHeader
          onRate={() => {
            router.push({
              pathname: '/rate',
              params: { ids: outfit.garmentIds.join(','), ...(occasion === null ? {} : { occasion }) },
            });
          }}
        />
        <OutfitStack garments={pieces} thumbUrls={thumbUrls} />
        {outfit.freshThisWeek ? <Text style={[styles.muted, styles.fresh]}>{t('today.fresh')}</Text> : null}
      </View>
    );
    secondary = {
      label: t('today.another'),
      tone: 'ghost',
      icon: Shuffle,
      disabled: pending || lucky.outfits.length < 2,
      onPress: () => {
        setWearError(null);
        lucky.next();
      },
    };
    primary = {
      label: logged ? t('outfit.logged') : t('outfit.wear'),
      tone: 'commit',
      ...(logged ? {} : { icon: Check }),
      disabled: logged || pending,
      onPress: () => {
        void wear(outfit, shownKey);
      },
    };
  }

  return (
    <Screen
      title={t('screen.today')}
      {...(primary === undefined
        ? {}
        : {
            cta: {
              primary,
              ...(secondary === undefined ? {} : { secondary }),
              ...(notice === undefined ? {} : { notice }),
            },
          })}
    >
      <WeatherLine text={weatherText} action={lucky.weather === null} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipsScroller}
        contentContainerStyle={styles.chipsContent}
      >
        <ChipGroup
          multiple={false}
          wrap={false}
          accessibilityLabel={t('today.occasion')}
          options={OCCASIONS.map((value) => ({ value, label: t(`occasion.${value}`) }))}
          selected={occasion === null ? [] : [occasion]}
          onChange={([next]: Occasion[]) => {
            setWearError(null);
            setOccasion(next ?? null);
          }}
        />
      </ScrollView>
      {body}
      {notice === undefined ? null : <View style={styles.noticeRoom} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  weatherLine: {
    alignSelf: 'flex-start',
    minHeight: WEATHER_LINE_HEIGHT,
    justifyContent: 'center',
    marginTop: -2,
  },
  weatherText: {
    color: colors.muted,
    fontSize: 13,
  },
  weatherAction: {
    color: colors.accentText,
    fontWeight: '700',
  },
  chipsScroller: {
    marginHorizontal: -spacing.md,
    flexGrow: 0,
  },
  chipsContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: (layout.minHitTarget - 36) / 2,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.95)',
    borderRadius: radii.card,
    padding: 10,
    gap: spacing.sm - 2,
    shadowColor: '#3c1e78',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: CHIP_AI_HEIGHT,
  },
  cardLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  muted: {
    color: colors.muted,
    fontSize: 13,
  },
  chipAi: {
    height: CHIP_AI_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e3d8ff',
    borderRadius: radii.pill,
  },
  chipAiLabel: {
    color: colors.accentText,
    fontSize: 12,
    fontWeight: '700',
  },
  fresh: {
    marginTop: 2,
    paddingHorizontal: 2,
  },
  placeholderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#ffffff',
    borderRadius: 13,
    paddingVertical: 7,
    paddingHorizontal: 9,
  },
  placeholderThumb: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: colors.tint,
  },
  placeholderText: {
    flex: 1,
    gap: 6,
  },
  placeholderBar: {
    height: 10,
    width: '35%',
    borderRadius: 5,
    backgroundColor: colors.track,
  },
  placeholderWide: {
    width: '60%',
  },
  message: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
    textAlign: 'center',
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  actionError: {
    alignSelf: 'center',
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.cell,
    backgroundColor: colors.errorTint,
    textAlign: 'center',
    color: colors.error,
    fontSize: 14,
  },
  noticeRoom: {
    height: NOTICE_ROOM,
  },
});
