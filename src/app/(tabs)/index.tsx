// Today (mockup 01 screen 1): the day's weather, an optional occasion, and the "feeling lucky"
// outfit with "Another" and "I'll wear it". The weather line opens the city modal; the card's
// "How does it look?" chip opens the rating.
import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { Check, Dices, RotateCw, Shirt, Shuffle, Sparkles } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { OCCASIONS, type Occasion } from '../../closet/catalog';
import { useCloset } from '../../closet/ClosetProvider';
import { useI18n } from '../../i18n';
import type { RequestError } from '../../lib/requestResult';
import { logWear } from '../../outfits/outfitRepository';
import { formatWeather } from '../../outfits/outfitDisplay';
import { OutfitStack } from '../../outfits/OutfitStack';
import type { LuckyOutfit } from '../../outfits/types';
import { useLuckyList, useTodayOccasion } from '../../outfits/useLuckyList';
import type { CtaAction } from '../../ui/AnchoredCta';
import { ChipGroup } from '../../ui/ChipGroup';
import { Screen } from '../../ui/Screen';
import { colors, layout, radii, spacing } from '../../ui/theme';

// Room for a message shown above the buttons, so it never covers the card's last row.
const NOTICE_ROOM = 56;
const CHIP_AI_HEIGHT = 28;

const outfitKey = (outfit: LuckyOutfit): string => outfit.garmentIds.join(',');

function WeatherLine({ text, prompt }: { text: string | null; prompt: boolean }): React.JSX.Element {
  const { t } = useI18n();
  if (text === null && !prompt) {
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
      hitSlop={{ top: 12, bottom: 12, right: 12 }}
      style={styles.weatherLine}
    >
      <Text style={[styles.weatherText, text === null ? styles.weatherPrompt : null]}>
        {text ?? t('today.weather.add')}
      </Text>
    </Pressable>
  );
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
 * re-render lands. `logged` and `wearError` are keyed by `<day>|<ids>`, so they belong to the
 * outfit they were for.
 */
function useWearLog(
  day: string,
  occasion: Occasion | null,
): {
  pending: boolean;
  logged: ReadonlySet<string>;
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
  const [logged, setLogged] = useState<ReadonlySet<string>>(() => new Set());
  const [wearError, setWearError] = useState<{ key: string; error: RequestError } | null>(null);
  // P4-R5: one id per wear attempt of an outfit, kept across a retry so a lost response can't log twice.
  const wearAttempt = useRef<{ key: string; id: string } | null>(null);

  const wear = useCallback(
    async (worn: LuckyOutfit, key: string) => {
      if (busy.current) return;
      busy.current = true;
      setPending(true);
      setWearError(null);
      if (wearAttempt.current?.key !== key) wearAttempt.current = { key, id: randomUUID() };
      const { id } = wearAttempt.current;
      const outcome = await logWear({ wearId: id, garmentIds: worn.garmentIds, wornOn: day, occasion, score: null });
      busy.current = false;
      if (!mounted.current) return;
      setPending(false);
      if (outcome.ok) {
        wearAttempt.current = null;
        setLogged((previous) => new Set(previous).add(key));
        void refresh();
      } else {
        setWearError({ key, error: outcome.error });
        AccessibilityInfo.announceForAccessibility(t(`outfit.error.${outcome.error}`));
      }
    },
    [day, occasion, refresh, t],
  );

  return { pending, logged, wearError, setWearError, wear };
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

  const { pending, logged, wearError, setWearError, wear } = useWearLog(lucky.day, occasion);

  const weatherText = formatWeather(lucky.weather, locale);
  const weatherResolved = lucky.state === 'ready' || lucky.state === 'too_small';

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
    const isLogged = logged.has(shownKey);
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
      label: isLogged ? t('outfit.logged') : t('outfit.wear'),
      tone: 'commit',
      ...(isLogged ? {} : { icon: Check }),
      disabled: isLogged || pending,
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
      <WeatherLine text={weatherText} prompt={weatherText === null && weatherResolved} />
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
    minHeight: 18,
    marginTop: -2,
  },
  weatherText: {
    color: colors.muted,
    fontSize: 13,
  },
  weatherPrompt: {
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
