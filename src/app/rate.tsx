// "How does it look?" (mockup 01 screen 3): the AI's rating of a picked outfit — the score ring and
// label, the AI confidence, template reasons, a one-tap swap for a low score — and Save / I'll wear
// it. Today and Build push it with the garment ids (`ids`, comma-separated) and an optional
// `occasion`. A root Stack screen inside the tabs guard, so there's no tab bar.
import { randomUUID } from 'expo-crypto';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, ChevronLeft, CircleAlert, RotateCw, Sparkles } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { GARMENT_COLORS, OCCASIONS, type GarmentColor, type Occasion } from '../closet/catalog';
import { useCloset } from '../closet/ClosetProvider';
import type { Garment } from '../closet/garmentRepository';
import { isMessageKey, useI18n, type Locale } from '../i18n';
import type { RequestError } from '../lib/requestResult';
import { localDate, rateOutfit, type AiError } from '../outfits/aiClient';
import { logWear, saveOutfit } from '../outfits/outfitRepository';
import { OutfitStack } from '../outfits/OutfitStack';
import { pieceLabel } from '../outfits/outfitDisplay';
import { useWornToday } from '../outfits/wornToday';
import { ScoreRing, ScoreRingPlaceholder } from '../outfits/ScoreRing';
import type { RatingReason, RatingResult } from '../outfits/types';
import { AnchoredCta } from '../ui/AnchoredCta';
import { CtaBackdrop } from '../ui/CtaBackdrop';
import { ScreenTitle, useScreenContentInsets } from '../ui/Screen';
import { colors, gradients, layout, radii, spacing } from '../ui/theme';

type Translate = ReturnType<typeof useI18n>['t'];

type Rating = { kind: 'loading' } | { kind: 'result'; result: RatingResult } | { kind: 'error'; error: AiError };

/** `rate-outfit`'s input bounds (its `MIN_GARMENTS`/`MAX_GARMENTS`); an outfit outside them isn't sent. */
const MIN_PIECES = 2;
const MAX_PIECES = 6;
/** The garment id shape `rate-outfit` accepts (`_shared/userContext.ts`'s `UUID`). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Room for a message shown above the buttons, so it never covers the outfit's last piece.
const NOTICE_ROOM = 56;
/** Below this score with no swap shown, the rating points to For you. */
const FOR_YOU_BELOW = 70;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseIds(raw: string | string[] | undefined): string[] {
  const joined = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
  return [...new Set(joined.split(',').map((id) => id.trim()))].filter((id) => id !== '');
}

/**
 * Why a link's ids can't be rated, without asking the function: a malformed id can't be a garment
 * (`not_found`), and too few or too many pieces aren't an outfit (`incomplete`). Either way a retry
 * can't succeed, so the screen offers only "Go back".
 */
function invalidIds(ids: readonly string[]): AiError | null {
  if (ids.some((id) => !UUID.test(id))) return 'not_found';
  if (ids.length < MIN_PIECES || ids.length > MAX_PIECES) return 'incomplete';
  return null;
}

function parseOccasion(raw: string | undefined): Occasion | null {
  return OCCASIONS.find((occasion) => occasion === raw) ?? null;
}

function isGarmentColor(value: string): value is GarmentColor {
  return (GARMENT_COLORS as readonly string[]).includes(value);
}

/** "Black", "Black and camel", "Navy, white and light blue": a list that opens a sentence. */
function joinColors(names: readonly string[], and: string, locale: Locale): string {
  const [head, ...tail] = names;
  if (head === undefined) return '';
  const rest = tail.map((name) => name.toLocaleLowerCase(locale));
  const last = rest.pop();
  return last === undefined ? head : `${[head, ...rest].join(', ')} ${and} ${last}`;
}

/**
 * A reason's text, or null for a key this app version doesn't know. color_harmony's good reason
 * carries `params.colors` as comma-separated enum values, localized here; with none it falls back
 * to a sentence without colors.
 */
function reasonText(reason: RatingReason, t: Translate, locale: Locale): string | null {
  if (!isMessageKey(reason.key)) return null;
  const params = reason.params ?? {};
  if (reason.key !== 'rating.reason.color_harmony.good') return t(reason.key, params);
  const names = (params.colors ?? '')
    .split(',')
    .filter(isGarmentColor)
    .map((color) => t(`garment.color.${color}`));
  const [only] = names;
  if (only === undefined) return t('rating.reason.color_harmony.good.plain');
  // One color sits mid-sentence ("The black tones…"), so it's lowercased; a list opens the sentence.
  if (names.length === 1) {
    return t('rating.reason.color_harmony.good.one', { ...params, colors: only.toLocaleLowerCase(locale) });
  }
  return t(reason.key, { ...params, colors: joinColors(names, t('rate.and'), locale) });
}

/** Back where the user came from; a deep link with no history lands on Build (leaveToCloset's pattern). */
function leaveToBuild(): void {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace('/build');
  }
}

function ReasonRow({ reason, text }: { reason: RatingReason; text: string }): React.JSX.Element {
  const { t } = useI18n();
  const good = reason.tone === 'good';
  const Icon = good ? Check : CircleAlert;
  return (
    <View style={styles.reason} accessible accessibilityLabel={`${t(`rate.reason.${reason.tone}`)}: ${text}`}>
      <View testID={`reason-icon-${reason.tone}`} style={styles.reasonIcon}>
        <Icon size={16} strokeWidth={3} color={good ? colors.positive : colors.warning} />
      </View>
      <Text style={styles.reasonText}>{text}</Text>
    </View>
  );
}

function SwapCard({
  from,
  to,
  disabled,
  onTry,
}: {
  from: Garment;
  to: Garment;
  disabled: boolean;
  onTry: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <View style={styles.swapCard}>
      <Text style={styles.swapText}>
        <Text style={styles.swapPrefix}>{t('rate.swap.prefix')}</Text>{' '}
        {t('rate.swap.body', { from: pieceLabel(from, t), to: pieceLabel(to, t) })}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onTry}
        // 36 pt like the mockup's small button; the slop keeps the 44 pt target.
        hitSlop={{ top: 4, bottom: 4 }}
        style={[styles.swapButton, disabled ? styles.dimmed : null]}
      >
        <LinearGradient colors={gradients.ai} style={styles.swapButtonFill}>
          <Sparkles size={13} color="#ffffff" fill="#ffffff" />
          <Text style={styles.swapButtonLabel}>{t('rate.swap.cta')}</Text>
        </LinearGradient>
      </Pressable>
    </View>
  );
}

/**
 * Mockup 01 screen 3's "Missing something? → For you": a low score with no swap to offer (none
 * beat it, or the fallback rater searched none) points to the pieces the closet lacks.
 */
function ForYouLink(): React.JSX.Element {
  const { t } = useI18n();
  const label = `${t('rate.forYou')} ${t('rate.forYou.link')}`;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={() => {
        router.push('/for-you');
      }}
      style={styles.forYouLink}
    >
      <Text style={styles.forYouText}>
        {t('rate.forYou')} <Text style={styles.forYouAccent}>{t('rate.forYou.link')}</Text>
      </Text>
    </Pressable>
  );
}

function ResultBody({
  result,
  pieces,
  byId,
  thumbUrls,
  swapDisabled,
  onSwap,
}: {
  result: RatingResult;
  pieces: Garment[];
  byId: ReadonlyMap<string, Garment>;
  thumbUrls: Map<string, string>;
  swapDisabled: boolean;
  onSwap: (fromId: string, toId: string) => void;
}): React.JSX.Element {
  const { t, locale } = useI18n();
  const reasons = result.reasons.flatMap((reason) => {
    const text = reasonText(reason, t, locale);
    return text === null ? [] : [{ reason, text }];
  });
  const { swap } = result;
  const from = swap === null ? undefined : byId.get(swap.fromId);
  const to = swap === null ? undefined : byId.get(swap.toId);
  const swapShown = swap !== null && from !== undefined && to !== undefined;
  return (
    <>
      <ScoreRing score={result.score} caption={t(`rating.label.${result.label}`)} />
      <Text style={styles.confidence}>
        {result.estimated || result.confidence === null
          ? t('rate.confidence.estimated')
          : t('rate.confidence', { value: result.confidence })}
      </Text>
      {reasons.length === 0 ? null : (
        <View style={styles.reasons}>
          {reasons.map(({ reason, text }) => (
            <ReasonRow key={reason.key} reason={reason} text={text} />
          ))}
        </View>
      )}
      {swapShown ? (
        <SwapCard
          from={from}
          to={to}
          disabled={swapDisabled}
          onTry={() => {
            onSwap(swap.fromId, swap.toId);
          }}
        />
      ) : null}
      {result.noBetterSwap ? <Text style={styles.noBetterSwap}>{t('rate.noBetterSwap')}</Text> : null}
      {result.score < FOR_YOU_BELOW && !swapShown ? <ForYouLink /> : null}
      {pieces.length === 0 ? null : (
        <View style={styles.card}>
          <OutfitStack garments={pieces} thumbUrls={thumbUrls} compact />
        </View>
      )}
    </>
  );
}

function RateOutfit({
  initialIds,
  initialError,
  occasion,
}: {
  initialIds: string[];
  initialError: AiError | null;
  occasion: Occasion | null;
}): React.JSX.Element {
  const { t } = useI18n();
  const insets = useScreenContentInsets('none');
  const { garments, thumbUrls, refresh } = useCloset();
  const byId = useMemo(() => new Map(garments.map((garment) => [garment.id, garment])), [garments]);

  const [ids, setIds] = useState(initialIds);
  // Only the link's ids can be invalid: a swap's target id comes from the function itself.
  const rateable = initialError === null;
  const pieces = useMemo(() => ids.flatMap((id) => byId.get(id) ?? []), [ids, byId]);

  // Bumped by "Try again": the effect below rates `ids` again.
  const [attempt, setAttempt] = useState(0);
  const [rating, setRating] = useState<Rating>(() =>
    initialError === null ? { kind: 'loading' } : { kind: 'error', error: initialError },
  );
  useEffect(() => {
    if (!rateable) return;
    let current = true;
    void rateOutfit({ garmentIds: ids, occasion, date: localDate() }).then((outcome) => {
      if (current) {
        setRating(outcome.ok ? { kind: 'result', result: outcome.result } : { kind: 'error', error: outcome.error });
      }
    });
    return () => {
      current = false;
    };
  }, [ids, occasion, rateable, attempt]);

  // False once the screen is gone: a late save or wear result is dropped.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Save and I'll wear it, one at a time. The ref locks a second tap before the re-render lands.
  const busy = useRef(false);
  const [pending, setPending] = useState<'save' | 'wear' | null>(null);
  const [saved, setSaved] = useState(false);
  // Shared with Today, so an outfit logged on either screen (or before a restart) stays logged here.
  const day = localDate();
  const { isWorn, markWorn } = useWornToday(day);
  const logged = isWorn(ids);
  const [actionError, setActionError] = useState<RequestError | null>(null);
  // One id per wear attempt, kept across a retry so a lost response can't log it twice.
  const wearId = useRef<string | null>(null);

  const run = useCallback(
    async (action: 'save' | 'wear', request: () => Promise<{ ok: true } | { ok: false; error: RequestError }>) => {
      if (busy.current) return false;
      busy.current = true;
      setPending(action);
      setActionError(null);
      const outcome = await request();
      busy.current = false;
      if (!mounted.current) return false;
      setPending(null);
      if (!outcome.ok) {
        setActionError(outcome.error);
        AccessibilityInfo.announceForAccessibility(t(`outfit.error.${outcome.error}`));
      }
      return outcome.ok;
    },
    [t],
  );

  const save = useCallback(async () => {
    if (await run('save', () => saveOutfit(ids))) setSaved(true);
  }, [run, ids]);

  const wear = useCallback(
    async (score: number) => {
      const id = (wearId.current ??= randomUUID());
      const done = await run('wear', () =>
        logWear({ wearId: id, garmentIds: ids, wornOn: day, occasion, score }),
      );
      if (done) {
        markWorn(ids);
        void refresh();
      }
    },
    [run, ids, day, occasion, markWorn, refresh],
  );

  const trySwap = useCallback((fromId: string, toId: string) => {
    if (busy.current) return;
    // A different outfit: its own save, wear and rating.
    wearId.current = null;
    setSaved(false);
    setActionError(null);
    setRating({ kind: 'loading' });
    setIds((current) => current.map((id) => (id === fromId ? toId : id)));
  }, []);

  const retry = useCallback(() => {
    setRating({ kind: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  const notice =
    actionError === null ? undefined : (
      <Text style={styles.actionError} accessibilityRole="alert">
        {t(`outfit.error.${actionError}`)}
      </Text>
    );

  let body: React.ReactNode;
  let cta: React.ReactNode = null;
  if (rating.kind === 'loading') {
    body = (
      <View style={styles.loading}>
        <ScoreRingPlaceholder />
        <Text style={styles.loadingText} accessibilityLiveRegion="polite">
          {t('rate.loading')}
        </Text>
      </View>
    );
  } else if (rating.kind === 'error') {
    const { error } = rating;
    body = (
      <Text style={styles.errorMessage} accessibilityRole="alert">
        {t(`rate.error.${error}`)}
      </Text>
    );
    const retryable = error === 'network' || error === 'unavailable' || error === 'unknown';
    cta = (
      <AnchoredCta
        chrome="none"
        primary={
          retryable
            ? { label: t('rate.retry'), tone: 'commit', icon: RotateCw, onPress: retry }
            : { label: t('rate.goBack'), tone: 'commit', onPress: leaveToBuild }
        }
      />
    );
  } else {
    const { result } = rating;
    body = (
      <ResultBody
        result={result}
        pieces={pieces}
        byId={byId}
        thumbUrls={thumbUrls}
        // A logged wear is of this outfit; swapping after it would rate one that wasn't worn.
        swapDisabled={pending !== null || logged}
        onSwap={trySwap}
      />
    );
    cta = (
      <AnchoredCta
        chrome="none"
        {...(notice === undefined ? {} : { notice })}
        secondary={{
          label: saved ? t('outfit.saved') : t('outfit.save'),
          tone: 'ghost',
          disabled: saved || pending !== null,
          onPress: () => {
            void save();
          },
        }}
        primary={{
          label: logged ? t('outfit.logged') : t('outfit.wear'),
          tone: 'commit',
          ...(logged ? {} : { icon: Check }),
          disabled: logged || pending !== null,
          onPress: () => {
            void wear(result.score);
          },
        }}
      />
    );
  }

  return (
    <LinearGradient colors={gradients.background} style={styles.fill}>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top, paddingBottom: insets.bottom + (notice === undefined ? 0 : NOTICE_ROOM) },
        ]}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('rate.back')}
            // Narrower than 44 pt so the title sits close to it; the slop keeps the 44 pt target.
            hitSlop={{ left: 8, right: 6 }}
            style={styles.backButton}
            onPress={leaveToBuild}
          >
            <ChevronLeft size={22} color={colors.ink} />
          </Pressable>
          <View style={styles.headerTitle}>
            <ScreenTitle title={t('rate.title')} />
          </View>
        </View>
        {body}
      </ScrollView>
      {cta === null ? null : (
        <>
          <CtaBackdrop />
          {cta}
        </>
      )}
    </LinearGradient>
  );
}

export default function RateScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{ ids?: string | string[]; occasion?: string | string[] }>();
  const ids = parseIds(params.ids);
  const occasion = parseOccasion(first(params.occasion));
  // Keyed by the outfit: a link to this screen while it's open (new params, same instance) starts
  // over with the new outfit instead of keeping the old one's rating and swap state.
  return (
    <RateOutfit
      key={`${ids.join(',')}|${occasion ?? ''}`}
      initialIds={ids}
      initialError={invalidIds(ids)}
      occasion={occasion}
    />
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm + 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  headerTitle: {
    flex: 1,
  },
  backButton: {
    width: 30,
    minHeight: layout.minHitTarget,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  loading: {
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 14,
    textAlign: 'center',
  },
  confidence: {
    color: colors.muted,
    fontSize: 13,
    textAlign: 'center',
  },
  reasons: {
    gap: spacing.sm - 2,
  },
  reason: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  reasonIcon: {
    paddingTop: 1,
  },
  reasonText: {
    flex: 1,
    color: colors.ink,
    fontSize: 14,
    lineHeight: 19,
  },
  swapCard: {
    backgroundColor: colors.tint,
    borderWidth: 1,
    borderColor: colors.tintBorder,
    borderRadius: 14,
    padding: 11,
    gap: spacing.sm + 1,
  },
  swapText: {
    color: colors.ink,
    fontSize: 14,
    lineHeight: 19,
  },
  swapPrefix: {
    fontWeight: '700',
  },
  swapButton: {
    minHeight: 36,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  swapButtonFill: {
    flex: 1,
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  swapButtonLabel: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  dimmed: {
    opacity: 0.5,
  },
  noBetterSwap: {
    color: colors.muted,
    fontSize: 13,
    textAlign: 'center',
  },
  forYouLink: {
    alignSelf: 'center',
    minHeight: layout.minHitTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    marginVertical: -spacing.sm,
  },
  forYouText: {
    color: colors.muted,
    fontSize: 13,
    textAlign: 'center',
  },
  forYouAccent: {
    color: colors.accentText,
    fontWeight: '700',
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.95)',
    borderRadius: radii.card,
    padding: 10,
    shadowColor: '#3c1e78',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  errorMessage: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
    textAlign: 'center',
    paddingTop: spacing.xl,
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
});
