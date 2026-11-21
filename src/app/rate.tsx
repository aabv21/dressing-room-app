// "How does it look?": the AI's rating of an outfit (score ring, confidence, reasons, a one-tap swap
// for a low score) with Save / I'll wear it. Pushed from Today and Build: `/rate?ids=…[&occasion=…]`.
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, CircleAlert, Layers, RotateCw, Share2, Sparkles } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { UUID } from '../../supabase/functions/_shared/guards.ts';
import { useAuth } from '../auth/AuthProvider';
import {
  GARMENT_COLORS,
  MAX_OUTFIT_PIECES,
  MIN_OUTFIT_PIECES,
  OCCASIONS,
  type GarmentColor,
  type Occasion,
  type Slot,
} from '../closet/catalog';
import { isSuggestable } from '../closet/closetSelectors';
import { useCloset } from '../closet/ClosetProvider';
import type { Garment } from '../closet/garmentRepository';
import { isMessageKey, useI18n, type Locale } from '../i18n';
import type { RequestError } from '../lib/requestResult';
import { localDate } from '../lib/localDate';
import { rateOutfit, type AiError } from '../outfits/aiClient';
import { saveOutfit } from '../outfits/outfitRepository';
import { OutfitStack } from '../outfits/OutfitStack';
import { missingPieceIdea, pieceLabel } from '../outfits/outfitDisplay';
import { readStoredForYou } from '../outfits/storedForYou';
import { ScoreRing, ScoreRingPlaceholder } from '../outfits/ScoreRing';
import { ShareOutfitSheet } from '../outfits/ShareOutfitSheet';
import type { RatingReason, RatingResult } from '../outfits/types';
import { useWearLog } from '../outfits/useWearLog';
import { announceForAccessibility } from '../ui/a11y';
import { ActionNotice, UndoNotice } from '../ui/ActionNotice';
import { AnchoredCta, type CtaAction } from '../ui/AnchoredCta';
import { BackChevron } from '../ui/BackChevron';
import { CtaBackdrop } from '../ui/CtaBackdrop';
import { LinkText } from '../ui/LinkText';
import { tapHaptic } from '../ui/feedback';
import { ScreenTitle, useScreenContentInsets } from '../ui/Screen';
import { useWaitStage } from '../ui/useWaitStage';
import { colors, fontSizes, gradients, layout, radii, spacing } from '../ui/theme';

type Translate = ReturnType<typeof useI18n>['t'];

type Rating = { kind: 'loading' } | { kind: 'result'; result: RatingResult } | { kind: 'error'; error: AiError };

// Room for a message shown above the buttons, so it never covers the outfit's last piece.
const NOTICE_ROOM = 56;
/** Below this score with no swap shown, the rating points to For you. */
const FOR_YOU_BELOW = 70;
/** Below this confidence the rating says the AI isn't sure; above it the number would read as a second score. */
const LOW_CONFIDENCE = 60;

/** The confidence in words, only when it should temper the score; null otherwise. */
function confidenceNote(result: RatingResult, t: Translate): string | null {
  if (result.estimated || result.confidence === null) return t('rate.confidence.estimated');
  return result.confidence < LOW_CONFIDENCE ? t('rate.confidence') : null;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseIds(raw: string | string[] | undefined): string[] {
  const joined = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
  return [...new Set(joined.split(',').map((id) => id.trim()))].filter((id) => id !== '');
}

/**
 * Why a link's ids can't be rated, without asking the function: a malformed id is `not_found`, a wrong
 * piece count `incomplete`. A retry can't succeed, so the screen offers only "Go back".
 */
function invalidIds(ids: readonly string[]): AiError | null {
  if (ids.some((id) => !UUID.test(id))) return 'not_found';
  if (ids.length < MIN_OUTFIT_PIECES || ids.length > MAX_OUTFIT_PIECES) return 'incomplete';
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
 * A reason's text, or null for a key this app version doesn't know. color_harmony's good reason carries
 * `params.colors` as comma-separated enum values, localized here (none: a sentence without colors).
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
        // A 36 pt button; the slop keeps the 44 pt target.
        hitSlop={{ top: 4, bottom: 4 }}
        style={[styles.swapButton, disabled ? styles.dimmed : null]}
      >
        <LinearGradient colors={gradients.ai} style={styles.swapButtonFill}>
          <Sparkles size={13} color={colors.onFill} fill={colors.onFill} />
          <Text style={styles.swapButtonLabel}>{t('rate.swap.cta')}</Text>
        </LinearGradient>
      </Pressable>
    </View>
  );
}

/** "Missing something? → For you": a low score with no swap (none beat it, or the fallback rater searched none). */
function ForYouLink({ weakestSlot }: { weakestSlot: Slot | null }): React.JSX.Element {
  const { t, locale } = useI18n();
  const { userId } = useAuth();
  // The piece comes from the last stored For you answer in this language (no model call), else generic.
  const stored = userId === null ? null : readStoredForYou(userId, locale);
  const idea = stored?.kind === 'ok' ? missingPieceIdea(stored.ideas, weakestSlot) : null;
  const question = idea === null ? t('rate.forYou') : t('rate.forYou.named', { piece: pieceLabel(idea, t) });
  const label = `${question} ${t('rate.forYou.link')}`;
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
        {question} <Text style={styles.forYouAccent}>{t('rate.forYou.link')}</Text>
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
  const note = confidenceNote(result, t);
  const reasons = result.reasons.flatMap((reason) => {
    const text = reasonText(reason, t, locale);
    return text === null ? [] : [{ reason, text }];
  });
  const { swap } = result;
  const from = swap === null ? undefined : byId.get(swap.fromId);
  const to = swap === null ? undefined : byId.get(swap.toId);
  // A cached rating can name a target the user has since taken out of suggestions.
  const swapShown = swap !== null && from !== undefined && to !== undefined && isSuggestable(to);
  // A swap to a garment the local closet lacks (added elsewhere or since the last refresh) would stay
  // hidden: refresh the closet once per swap target.
  const { refresh } = useCloset();
  const refreshedFor = useRef<string | null>(null);
  const missingTarget = swap !== null && (from === undefined || to === undefined) ? swap.toId : null;
  useEffect(() => {
    if (missingTarget === null || refreshedFor.current === missingTarget) return;
    refreshedFor.current = missingTarget;
    void refresh();
  }, [missingTarget, refresh]);
  return (
    <>
      <ScoreRing score={result.score} caption={t(`rating.label.${result.label}`)} />
      {note === null ? null : <Text style={styles.confidence}>{note}</Text>}
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
      {result.score < FOR_YOU_BELOW && !swapShown ? <ForYouLink weakestSlot={result.weakestSlot} /> : null}
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
  const { garments, thumbUrls } = useCloset();
  const byId = useMemo(() => new Map(garments.map((garment) => [garment.id, garment])), [garments]);

  const [ids, setIds] = useState(initialIds);
  // Only the link's ids can be invalid: a swap's target id comes from the function itself.
  const rateable = initialError === null;
  const pieces = useMemo(() => ids.flatMap((id) => byId.get(id) ?? []), [ids, byId]);

  // Bumped by "Try again" to rate `ids` again.
  const [attempt, setAttempt] = useState(0);
  const [rating, setRating] = useState<Rating>(() =>
    initialError === null ? { kind: 'loading' } : { kind: 'error', error: initialError },
  );
  useEffect(() => {
    if (!rateable) return;
    let current = true;
    void rateOutfit({ garmentIds: ids, occasion, date: localDate() }).then((outcome) => {
      if (!current) return;
      if (outcome.ok) tapHaptic('success');
      setRating(outcome.ok ? { kind: 'result', result: outcome.result } : { kind: 'error', error: outcome.error });
    });
    return () => {
      current = false;
    };
  }, [ids, occasion, rateable, attempt]);

  // False once the screen is gone: a late save result is dropped.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Shared with Today, so an outfit logged on either screen (or before a restart) stays logged here.
  const { log, busy: wearBusy, isLogged, errorFor, clearError, isQueued, canUndo, undo, undoFailedFor } =
    useWearLog(localDate());
  const logged = isLogged(ids);
  // Save, one at a time and never during a wear. The ref locks a second tap before the re-render lands.
  const saving = useRef(false);
  const [savePending, setSavePending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<RequestError | null>(null);
  const pending = savePending || wearBusy;

  const save = useCallback(async (score: number) => {
    if (saving.current || wearBusy) return;
    saving.current = true;
    setSavePending(true);
    setSaveError(null);
    clearError();
    const outcome = await saveOutfit(ids, score);
    saving.current = false;
    if (!mounted.current) return;
    setSavePending(false);
    if (outcome.ok) {
      setSaved(true);
    } else {
      setSaveError(outcome.error);
      announceForAccessibility(t(`outfit.error.${outcome.error}`));
    }
  }, [ids, t, wearBusy, clearError]);

  const wear = useCallback(
    (score: number) => {
      if (saving.current) return;
      setSaveError(null);
      void log(ids, occasion, score);
    },
    [ids, occasion, log],
  );

  const trySwap = useCallback(
    (fromId: string, toId: string) => {
      if (saving.current || wearBusy) return;
      // A different outfit: its own save, wear and rating.
      setSaved(false);
      setSaveError(null);
      clearError();
      setRating({ kind: 'loading' });
      setIds((current) => current.map((id) => (id === fromId ? toId : id)));
    },
    [wearBusy, clearError],
  );

  const waitStage = useWaitStage(rating.kind === 'loading');
  const [shareOpen, setShareOpen] = useState(false);
  const shareable = rating.kind === 'result' && pieces.length > 0;

  const retry = useCallback(() => {
    setRating({ kind: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  let notice: React.ReactNode = undefined;
  // The queued note and Undo stack for the first seconds after an offline wear.
  let noticeRows = 1;
  const actionError = saveError ?? errorFor(ids);
  if (actionError !== null) {
    notice = <ActionNotice tone="error">{t(`outfit.error.${actionError}`)}</ActionNotice>;
  } else if (canUndo(ids)) {
    const undoFailed = undoFailedFor(ids);
    const queued = isQueued(ids);
    noticeRows = undoFailed || queued ? 2 : 1;
    notice = (
      <View style={styles.notices}>
        {undoFailed ? <ActionNotice tone="error">{t('outfit.undoFailed')}</ActionNotice> : null}
        {!undoFailed && queued ? <ActionNotice tone="queued">{t('outfit.queued')}</ActionNotice> : null}
        <UndoNotice
          label={t('outfit.undo')}
          hint={t('outfit.undo.hint')}
          onPress={() => {
            void undo(ids);
          }}
        />
      </View>
    );
  } else if (undoFailedFor(ids)) {
    notice = <ActionNotice tone="error">{t('outfit.undoFailed')}</ActionNotice>;
  } else if (logged && isQueued(ids)) {
    notice = <ActionNotice tone="queued">{t('outfit.queued')}</ActionNotice>;
  } else if (saved) {
    notice = (
      <View style={styles.savedLink}>
        <LinkText
          style={styles.savedLinkText}
          onPress={() => {
            router.dismissTo({ pathname: '/closet', params: { segment: 'saved' } });
          }}
        >
          {t('outfit.saved.see')}
        </LinkText>
      </View>
    );
  }

  let body: React.ReactNode;
  let cta: React.ReactNode = null;
  if (rating.kind === 'loading') {
    body = (
      <View style={styles.loading}>
        <ScoreRingPlaceholder />
        <Text style={styles.loadingText} accessibilityLiveRegion="polite">
          {waitStage === 'start' ? t('rate.loading') : t(`wait.${waitStage}`)}
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
    let primary: CtaAction = { label: t('rate.goBack'), tone: 'commit', onPress: leaveToBuild };
    if (retryable) {
      primary = { label: t('rate.retry'), tone: 'commit', icon: RotateCw, onPress: retry };
    } else if (error === 'over_quota') {
      // Back down to the tabs under this screen, on Build; `navigate` would stack another tab navigator.
      primary = {
        label: t('rate.buildOwn'),
        tone: 'commit',
        icon: Layers,
        onPress: () => {
          router.dismissTo('/build');
        },
      };
    }
    cta = <AnchoredCta chrome="none" primary={primary} />;
  } else {
    const { result } = rating;
    body = (
      <ResultBody
        result={result}
        pieces={pieces}
        byId={byId}
        thumbUrls={thumbUrls}
        // A logged wear is of this outfit; swapping after it would rate one that wasn't worn.
        swapDisabled={pending || logged}
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
          disabled: saved || pending,
          onPress: () => {
            void save(result.score);
          },
        }}
        primary={{
          label: logged ? t('outfit.logged') : t('outfit.wear'),
          tone: 'commit',
          ...(logged ? {} : { icon: Check }),
          disabled: logged || pending,
          onPress: () => {
            wear(result.score);
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
          { paddingTop: insets.top, paddingBottom: insets.bottom + (notice === undefined ? 0 : NOTICE_ROOM * noticeRows) },
        ]}
      >
        <View style={styles.header}>
          <BackChevron label={t('rate.back')} onPress={leaveToBuild} />
          <View style={styles.headerTitle}>
            <ScreenTitle title={t('rate.title')} />
          </View>
          {shareable ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('share.action')}
              hitSlop={4}
              onPress={() => {
                setShareOpen(true);
              }}
              style={styles.shareButton}
            >
              <Share2 size={20} color={colors.accentText} />
            </Pressable>
          ) : null}
        </View>
        {body}
      </ScrollView>
      {rating.kind === 'result' ? (
        <ShareOutfitSheet
          visible={shareOpen}
          garments={pieces}
          thumbUrls={thumbUrls}
          score={rating.result.score}
          onClose={() => {
            setShareOpen(false);
          }}
        />
      ) : null}
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
  // Keyed by the outfit: a link while open (new params, same instance) starts over with fresh state.
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
  shareButton: {
    minWidth: layout.minHitTarget,
    minHeight: layout.minHitTarget,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  loading: {
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  loadingText: {
    color: colors.muted,
    fontSize: fontSizes.body,
    textAlign: 'center',
  },
  confidence: {
    color: colors.muted,
    fontSize: fontSizes.bodySmall,
    textAlign: 'center',
  },
  reasons: {
    gap: spacing.sm - 2,
  },
  notices: {
    gap: spacing.sm,
  },
  savedLink: {
    alignSelf: 'center',
  },
  savedLinkText: {
    color: colors.accentText,
    fontSize: fontSizes.body,
    fontWeight: '700',
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
    fontSize: fontSizes.body,
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
    fontSize: fontSizes.body,
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
    color: colors.onFill,
    fontSize: fontSizes.bodySmall,
    fontWeight: '700',
  },
  dimmed: {
    opacity: 0.5,
  },
  noBetterSwap: {
    color: colors.muted,
    fontSize: fontSizes.bodySmall,
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
    fontSize: fontSizes.bodySmall,
    textAlign: 'center',
  },
  forYouAccent: {
    color: colors.accentText,
    fontWeight: '700',
  },
  card: {
    backgroundColor: colors.glass[75],
    borderWidth: 1,
    borderColor: colors.glass[95],
    borderRadius: radii.card,
    padding: 10,
    shadowColor: colors.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  errorMessage: {
    color: colors.ink,
    fontSize: fontSizes.title,
    fontWeight: '600',
    lineHeight: 22,
    textAlign: 'center',
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.sm,
  },
});
