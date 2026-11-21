// Today: the weather (opens the city modal), an optional occasion, and the day's outfit with
// "Another", "I'll wear it" and "How does it look?" (the rating).
import { router } from 'expo-router';
import { Check, Dices, Layers, RotateCw, Shirt, Shuffle, Sparkles, WifiOff } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../auth/AuthProvider';
import { OCCASIONS, type Occasion } from '../../closet/catalog';
import { useCloset } from '../../closet/ClosetProvider';
import type { Garment } from '../../closet/garmentRepository';
import { useI18n } from '../../i18n';
import type { RequestError } from '../../lib/requestResult';
import { formatWeather, formatWeekday, orderPieces, pieceLabel } from '../../outfits/outfitDisplay';
import { OutfitStack } from '../../outfits/OutfitStack';
import { useLuckyList, useTodayOccasion } from '../../outfits/useLuckyList';
import { useWearLog } from '../../outfits/useWearLog';
import { dismissOutfit, stopSuggesting } from '../../outfits/suggestionFeedback';
import { outfitIdentity } from '../../outfits/wornToday';
import { announceForAccessibility } from '../../ui/a11y';
import type { AiError } from '../../outfits/aiClient';
import { ActionNotice, UndoNotice } from '../../ui/ActionNotice';
import type { CtaAction } from '../../ui/AnchoredCta';
import { ChipGroup } from '../../ui/ChipGroup';
import { Screen } from '../../ui/Screen';
import { useWaitStage } from '../../ui/useWaitStage';
import { colors, fontSizes, layout, radii, spacing } from '../../ui/theme';

// Room for a message shown above the buttons, so it never covers the card's last row.
const NOTICE_ROOM = 56;
const CHIP_AI_HEIGHT = 28;
const WEATHER_LINE_HEIGHT = 18;
// The weather line is one short text row; the slop tops its tap area up to the 44 pt minimum.
const WEATHER_SLOP = (layout.minHitTarget - WEATHER_LINE_HEIGHT) / 2;

/** The day's weather; with none, why (a city with no weather) or a prompt to add one. */
function WeatherLine({
  weekday,
  text,
  action,
}: {
  weekday: string;
  text: string | null;
  action: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  if (text === null) {
    // The day alone while the weather is unknown: the line always names it.
    return (
      <View style={styles.weatherLine}>
        <Text style={styles.weatherText}>{weekday}</Text>
      </View>
    );
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

/** Null for no city, `undefined` while loading. A failed read counts as no city, so the line offers one. */
function useProfileCity(): string | null | undefined {
  const { profile, profileStatus } = useAuth();
  if (profileStatus === 'loading') return undefined;
  const name = profile?.city_name?.trim() ?? '';
  return name === '' ? null : name;
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
  const stage = useWaitStage(true);
  const label = stage === 'start' ? t('today.loading') : t(`wait.${stage}`);
  return (
    <View style={styles.card} accessible accessibilityLabel={label} accessibilityLiveRegion="polite">
      <CardHeader />
      {stage === 'start' ? null : <Text style={[styles.muted, styles.waitText]}>{label}</Text>}
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

/** Shown when the list is an earlier one because the fetch couldn't connect. */
function OfflineNote(): React.JSX.Element {
  const { t } = useI18n();
  return (
    <View style={styles.offline} accessible accessibilityLiveRegion="polite">
      <WifiOff size={13} color={colors.muted} />
      <Text style={[styles.muted, styles.offlineText]}>{t('today.offline')}</Text>
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

const NOT_FOR_ME_HEIGHT = 28;
const NOT_FOR_ME_SLOP = (layout.minHitTarget - NOT_FOR_ME_HEIGHT) / 2;

/** "Not for me": don't suggest the combination, or one of its pieces (docs/app.md#outfits-srcoutfits). */
function NotForMePanel({
  pieces,
  busy,
  error,
  onCombination,
  onPiece,
  onCancel,
}: {
  pieces: readonly Garment[];
  busy: boolean;
  error: RequestError | null;
  onCombination: () => void;
  onPiece: (piece: Garment) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <View style={styles.panel} testID="not-for-me">
      <Text style={styles.panelTitle} accessibilityRole="header">
        {t('today.notForMe.title')}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={onCombination}
        style={[styles.panelButton, busy ? styles.dimmed : null]}
      >
        <Text style={styles.panelButtonText}>{t('today.notForMe.combination')}</Text>
      </Pressable>
      <Text style={styles.muted}>{t('today.notForMe.piece')}</Text>
      <View style={styles.panelPieces}>
        {orderPieces(pieces).map((piece) => {
          const label = pieceLabel(piece, t);
          return (
            <Pressable
              key={piece.id}
              accessibilityRole="button"
              accessibilityLabel={t('today.notForMe.pieceLabel', { piece: label })}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              hitSlop={NOT_FOR_ME_SLOP}
              onPress={() => {
                onPiece(piece);
              }}
              style={[styles.pieceChip, busy ? styles.dimmed : null]}
            >
              <Text style={styles.pieceChipText}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      {error === null ? null : (
        <Text style={styles.panelError} accessibilityRole="alert">
          {t(`today.notForMe.error.${error}`)}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        hitSlop={NOT_FOR_ME_SLOP}
        onPress={onCancel}
        style={styles.notForMe}
      >
        <Text style={styles.notForMeText}>{t('today.notForMe.cancel')}</Text>
      </Pressable>
    </View>
  );
}

/**
 * The way out of an error. Over quota can't succeed again today and a missing piece won't come back
 * on a retry, so those lead to Build and the closet instead.
 */
function errorAction(error: AiError, t: ReturnType<typeof useI18n>['t'], reload: () => void): CtaAction {
  if (error === 'over_quota') {
    return {
      label: t('today.buildOwn'),
      tone: 'commit',
      icon: Layers,
      onPress: () => {
        router.push('/build');
      },
    };
  }
  if (error === 'not_found' || error === 'incomplete') {
    return {
      label: t('today.tooSmall.cta'),
      tone: 'commit',
      icon: Shirt,
      onPress: () => {
        router.push('/closet');
      },
    };
  }
  return { label: t('today.retry'), tone: 'commit', icon: RotateCw, onPress: reload };
}

export default function TodayScreen(): React.JSX.Element {
  const { t, locale } = useI18n();
  const [occasion, setOccasion] = useTodayOccasion();
  const lucky = useLuckyList(occasion);
  const { garments, thumbUrls, replaceLocal } = useCloset();
  const byId = useMemo(() => new Map(garments.map((garment) => [garment.id, garment])), [garments]);

  const outfit = lucky.state === 'ready' ? lucky.outfits[lucky.index] : undefined;
  const pieces = useMemo(() => outfit?.garmentIds.flatMap((id) => byId.get(id) ?? []) ?? [], [outfit, byId]);

  // Keyed by outfit: a failed or queued wear's note stays with the outfit it was for.
  const wearLog = useWearLog(lucky.day);

  // "Not for me" is open for one outfit at a time; its confirmation outlives the outfit it hid.
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackError, setFeedbackError] = useState<RequestError | null>(null);
  const [feedbackDone, setFeedbackDone] = useState<string | null>(null);
  const openFeedback = useCallback((garmentIds: readonly string[]) => {
    setFeedbackFor(outfitIdentity(garmentIds));
    setFeedbackError(null);
    setFeedbackDone(null);
  }, []);
  const closeFeedback = useCallback(() => {
    setFeedbackFor(null);
    setFeedbackError(null);
  }, []);
  const finishFeedback = useCallback((message: string) => {
    setFeedbackFor(null);
    setFeedbackDone(message);
    announceForAccessibility(message);
  }, []);
  const dismissCombination = useCallback(
    async (garmentIds: readonly string[]) => {
      setFeedbackBusy(true);
      setFeedbackError(null);
      const result = await dismissOutfit(garmentIds);
      setFeedbackBusy(false);
      if (!result.ok) {
        setFeedbackError(result.error);
        return;
      }
      lucky.dismiss(garmentIds);
      finishFeedback(t('today.notForMe.doneCombination'));
    },
    [lucky, finishFeedback, t],
  );
  const unsuggestPiece = useCallback(
    async (piece: Garment) => {
      setFeedbackBusy(true);
      setFeedbackError(null);
      const result = await stopSuggesting(piece.id);
      setFeedbackBusy(false);
      if (!result.ok) {
        setFeedbackError(result.error);
        return;
      }
      lucky.skip((candidate) => candidate.garmentIds.includes(piece.id));
      replaceLocal({ ...piece, suggest: false });
      finishFeedback(t('today.notForMe.donePiece', { piece: pieceLabel(piece, t) }));
    },
    [lucky, replaceLocal, finishFeedback, t],
  );

  const weatherResolved = lucky.state === 'ready' || lucky.state === 'too_small';
  const cityWithoutWeather = useProfileCity();
  // Noon of the list's day, so the weekday is the day's whatever the time zone.
  const dayDate = new Date(`${lucky.day}T12:00:00`);
  const weekday = formatWeekday(locale, dayDate);
  let weatherText = formatWeather(lucky.weather, locale, dayDate);
  if (weatherText === null && weatherResolved && cityWithoutWeather !== undefined) {
    weatherText = `${weekday} · ${
      cityWithoutWeather === null
        ? t('today.weather.add')
        : t('today.weather.unavailable', { city: cityWithoutWeather })
    }`;
  }

  let notice: React.ReactNode = undefined;
  // The queued note and Undo stack for the first seconds after an offline wear.
  let noticeRows = 1;
  const wearError = outfit === undefined ? null : wearLog.errorFor(outfit.garmentIds);
  if (wearError !== null) {
    notice = <ActionNotice tone="error">{t(`outfit.error.${wearError}`)}</ActionNotice>;
  } else if (outfit !== undefined && wearLog.canUndo(outfit.garmentIds)) {
    const { garmentIds } = outfit;
    const undoFailed = wearLog.undoFailedFor(garmentIds);
    const queued = wearLog.isQueued(garmentIds);
    noticeRows = undoFailed || queued ? 2 : 1;
    notice = (
      <View style={styles.notices}>
        {undoFailed ? <ActionNotice tone="error">{t('outfit.undoFailed')}</ActionNotice> : null}
        {!undoFailed && queued ? <ActionNotice tone="queued">{t('outfit.queued')}</ActionNotice> : null}
        <UndoNotice
          label={t('outfit.undo')}
          hint={t('outfit.undo.hint')}
          onPress={() => {
            void wearLog.undo(garmentIds);
          }}
        />
      </View>
    );
  } else if (outfit !== undefined && wearLog.undoFailedFor(outfit.garmentIds)) {
    notice = <ActionNotice tone="error">{t('outfit.undoFailed')}</ActionNotice>;
  } else if (outfit !== undefined && wearLog.isQueued(outfit.garmentIds)) {
    notice = <ActionNotice tone="queued">{t('outfit.queued')}</ActionNotice>;
  }

  let body: React.ReactNode;
  let primary: CtaAction | undefined;
  let secondary: CtaAction | undefined;
  if (lucky.state === 'loading') {
    body = <LoadingCard />;
  } else if (lucky.state === 'error') {
    const error = lucky.error ?? 'unknown';
    body = <Message>{t(`today.error.${error}`)}</Message>;
    primary = errorAction(error, t, lucky.reload);
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
  } else if (outfit === undefined && lucky.refetchError !== null) {
    // Every outfit was hidden (a piece went to the laundry) and the refetch failed: say why, offer a retry.
    const error = lucky.refetchError;
    body = <Message>{t(`today.error.${error}`)}</Message>;
    primary = errorAction(error, t, lucky.reload);
  } else if (outfit === undefined) {
    body = <Message>{occasion === null ? t('today.empty') : t('today.empty.occasion')}</Message>;
  } else {
    const logged = wearLog.isLogged(outfit.garmentIds);
    const { garmentIds } = outfit;
    const feedbackOpen = feedbackFor === outfitIdentity(garmentIds);
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
        <View style={styles.cardFooter}>
          {outfit.freshThisWeek ? <Text style={[styles.muted, styles.fresh]}>{t('today.fresh')}</Text> : <View />}
          {feedbackOpen ? null : (
            <Pressable
              accessibilityRole="button"
              hitSlop={NOT_FOR_ME_SLOP}
              onPress={() => {
                openFeedback(garmentIds);
              }}
              style={styles.notForMe}
            >
              <Text style={styles.notForMeText}>{t('today.notForMe')}</Text>
            </Pressable>
          )}
        </View>
        {feedbackOpen ? (
          <NotForMePanel
            pieces={pieces}
            busy={feedbackBusy}
            error={feedbackError}
            onCombination={() => {
              void dismissCombination(garmentIds);
            }}
            onPiece={(piece) => {
              void unsuggestPiece(piece);
            }}
            onCancel={closeFeedback}
          />
        ) : null}
        {feedbackDone === null || feedbackOpen ? null : (
          <Text style={[styles.muted, styles.fresh]} accessibilityLiveRegion="polite">
            {feedbackDone}
          </Text>
        )}
      </View>
    );
    secondary = {
      label: t('today.another'),
      tone: 'ghost',
      icon: Shuffle,
      disabled: wearLog.busy || lucky.outfits.length < 2,
      onPress: () => {
        wearLog.clearError();
        closeFeedback();
        setFeedbackDone(null);
        lucky.next();
      },
    };
    primary = {
      label: logged ? t('outfit.logged') : t('outfit.wear'),
      tone: 'commit',
      ...(logged ? {} : { icon: Check }),
      disabled: logged || wearLog.busy,
      onPress: () => {
        void wearLog.log(outfit.garmentIds, occasion, outfit.score);
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
      <WeatherLine weekday={weekday} text={weatherText} action={lucky.weather === null} />
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
            wearLog.clearError();
            setOccasion(next ?? null);
          }}
        />
      </ScrollView>
      {lucky.offline ? <OfflineNote /> : null}
      {body}
      {notice === undefined ? null : <View style={{ height: NOTICE_ROOM * noticeRows }} />}
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
    fontSize: fontSizes.bodySmall,
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
    backgroundColor: colors.glass[75],
    borderWidth: 1,
    borderColor: colors.glass[95],
    borderRadius: radii.card,
    padding: 10,
    gap: spacing.sm - 2,
    shadowColor: colors.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  // Wraps the chip under the label when a large text size leaves no room for both on one line.
  cardHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: CHIP_AI_HEIGHT,
  },
  cardLabel: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  muted: {
    color: colors.muted,
    fontSize: fontSizes.bodySmall,
  },
  chipAi: {
    minHeight: CHIP_AI_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    borderRadius: radii.pill,
  },
  chipAiLabel: {
    color: colors.accentText,
    fontSize: fontSizes.caption,
    fontWeight: '700',
  },
  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 2,
  },
  // Wraps beside the icon at a large text size instead of running off the screen.
  offlineText: {
    flexShrink: 1,
  },
  waitText: {
    paddingHorizontal: 2,
  },
  fresh: {
    flexShrink: 1,
    marginTop: 2,
    paddingHorizontal: 2,
  },
  // Wraps "Not for me" under the fresh line when a large text size leaves no room for both.
  cardFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  notForMe: {
    minHeight: NOT_FOR_ME_HEIGHT,
    justifyContent: 'center',
    alignSelf: 'flex-end',
    paddingHorizontal: spacing.sm,
  },
  notForMeText: {
    color: colors.accentText,
    fontSize: fontSizes.bodySmall,
    fontWeight: '700',
  },
  panel: {
    gap: spacing.sm,
    padding: spacing.sm + 2,
    borderRadius: radii.cell,
    borderWidth: 1,
    borderColor: colors.tintBorder,
    backgroundColor: colors.tint,
  },
  panelTitle: {
    color: colors.ink,
    fontSize: fontSizes.body,
    fontWeight: '800',
  },
  panelButton: {
    minHeight: layout.minHitTarget,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.surface,
  },
  panelButtonText: {
    color: colors.accentText,
    fontSize: fontSizes.body,
    fontWeight: '700',
    textAlign: 'center',
  },
  panelPieces: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pieceChip: {
    minHeight: NOT_FOR_ME_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm + 4,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  pieceChipText: {
    color: colors.ink,
    fontSize: fontSizes.caption,
    fontWeight: '700',
  },
  panelError: {
    color: colors.error,
    fontSize: fontSizes.bodySmall,
  },
  dimmed: {
    opacity: 0.4,
  },
  placeholderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
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
    fontSize: fontSizes.title,
    fontWeight: '600',
    lineHeight: 22,
    textAlign: 'center',
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  notices: {
    gap: spacing.sm,
  },
});
