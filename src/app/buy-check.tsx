// "Should I buy it?": a photo of a piece the user is thinking of buying, compared with their closet
// (docs/app.md#should-i-buy-it-srcbuycheck). Pushed from For you; nothing is kept.
import { router } from 'expo-router';
import { Camera, Images, Lock, Plus, RotateCcw, RotateCw } from 'lucide-react-native';
import type { ComponentProps } from 'react';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { BuyCheckResponse } from '../buyCheck/buyCheckClient';
import { useBuyCheck } from '../buyCheck/useBuyCheck';
import { useCloset } from '../closet/ClosetProvider';
import type { Garment } from '../closet/garmentRepository';
import { pluralKey, useI18n } from '../i18n';
import type { AiError } from '../outfits/aiClient';
import { pieceLabel } from '../outfits/outfitDisplay';
import { OutfitStack } from '../outfits/OutfitStack';
import { ActionNotice } from '../ui/ActionNotice';
import type { AnchoredCta, CtaAction } from '../ui/AnchoredCta';
import { BackChevron } from '../ui/BackChevron';
import { Screen } from '../ui/Screen';
import { colors, fontSizes, radii, spacing } from '../ui/theme';

type Cta = ComponentProps<typeof AnchoredCta>;
type Ok = Extract<BuyCheckResponse, { kind: 'ok' }>;
type Translate = ReturnType<typeof useI18n>['t'];

/** The errors the screen has copy for; the rest read as "unknown". */
function errorCopy(error: AiError | 'photo'): 'over_quota' | 'network' | 'unavailable' | 'photo' | 'unknown' {
  return error === 'over_quota' || error === 'network' || error === 'unavailable' || error === 'photo' ? error : 'unknown';
}

function verdictLine(result: Ok, t: Translate): string {
  switch (result.verdict) {
    case 'buy':
      return t(pluralKey('buyCheck.verdict.buy', result.newOutfits), { count: result.newOutfits });
    case 'skip':
      return t('buyCheck.verdict.skip');
    case 'think':
      return t('buyCheck.verdict.think');
  }
}

function ResultCard({ result, added }: { result: Ok; added: boolean }): React.JSX.Element {
  const { t } = useI18n();
  const { garments, thumbUrls } = useCloset();
  const byId = useMemo(() => new Map(garments.map((garment) => [garment.id, garment])), [garments]);
  // A duplicate deleted since the check has nothing to show or open.
  const duplicates = result.duplicates.flatMap(({ id }) => byId.get(id) ?? []);
  return (
    <>
      <View style={styles.card}>
        <Text style={styles.verdict} accessibilityLiveRegion="polite">
          {verdictLine(result, t)}
        </Text>
        <Text style={styles.muted}>{t('buyCheck.item', { piece: pieceLabel(result.item, t) })}</Text>
        <Text style={styles.count}>{t(pluralKey('buyCheck.outfits', result.newOutfits), { count: result.newOutfits })}</Text>
      </View>
      {duplicates.length === 0 ? null : (
        <View style={styles.card}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {t('buyCheck.similar')}
          </Text>
          {duplicates.map((garment: Garment) => (
            <Pressable
              key={garment.id}
              accessibilityRole="link"
              accessibilityLabel={t('buyCheck.openGarment', { piece: pieceLabel(garment, t) })}
              onPress={() => {
                router.push(`/garment/${garment.id}`);
              }}
              style={({ pressed }) => (pressed ? styles.pressed : null)}
            >
              <OutfitStack garments={[garment]} thumbUrls={thumbUrls} compact />
            </Pressable>
          ))}
        </View>
      )}
      {added ? <ActionNotice tone="queued">{t('buyCheck.added')}</ActionNotice> : null}
    </>
  );
}

export default function BuyCheckScreen(): React.JSX.Element {
  const { t } = useI18n();
  const { state, start, retry, add, reset } = useBuyCheck();

  const again: CtaAction = { label: t('buyCheck.again'), tone: 'ghost', icon: RotateCcw, onPress: reset };
  let body: React.ReactNode;
  let cta: Cta | undefined;
  switch (state.step) {
    case 'idle':
      body = (
        <>
          <Text style={styles.intro}>{t('buyCheck.intro')}</Text>
          <View style={styles.row}>
            <Lock size={13} color={colors.muted} />
            <Text style={styles.muted}>{t('buyCheck.privacy')}</Text>
          </View>
        </>
      );
      cta = {
        primary: { label: t('buyCheck.takePhoto'), tone: 'ai', icon: Camera, onPress: () => void start('camera') },
        secondary: { label: t('buyCheck.pickPhoto'), tone: 'ghost', icon: Images, onPress: () => void start('gallery') },
      };
      break;
    case 'checking':
      body = (
        <View style={styles.row} accessible accessibilityLabel={t('buyCheck.checking')} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.muted}>{t('buyCheck.checking')}</Text>
        </View>
      );
      break;
    case 'done':
      if (state.result.kind === 'not_garment') {
        body = (
          <Text style={styles.message} accessibilityRole="alert">
            {t('buyCheck.notGarment')}
          </Text>
        );
        cta = { primary: { ...again, tone: 'commit' } };
      } else {
        body = <ResultCard result={state.result} added={state.added} />;
        cta = state.added
          ? { primary: { ...again, tone: 'commit' } }
          : { primary: { label: t('buyCheck.add'), tone: 'commit', icon: Plus, onPress: add }, secondary: again };
      }
      break;
    case 'failed':
      body = (
        <Text style={styles.message} accessibilityRole="alert">
          {t(`buyCheck.error.${errorCopy(state.error)}`)}
        </Text>
      );
      // Over the quota nothing can succeed until tomorrow; an unreadable photo needs another one.
      if (state.error === 'photo') cta = { primary: { ...again, tone: 'commit' } };
      else if (state.error !== 'over_quota') {
        cta = { primary: { label: t('buyCheck.retry'), tone: 'commit', icon: RotateCw, onPress: () => void retry() }, secondary: again };
      }
      break;
  }

  return (
    <Screen
      title={t('buyCheck.title')}
      chrome="none"
      headerAccessory={
        <BackChevron
          label={t('buyCheck.back')}
          onPress={() => {
            router.back();
          }}
        />
      }
      {...(cta === undefined ? {} : { cta })}
    >
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: {
    color: colors.inkSoft,
    fontSize: fontSizes.body,
    lineHeight: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm - 2,
  },
  muted: {
    flexShrink: 1,
    color: colors.muted,
    fontSize: fontSizes.bodySmall,
  },
  card: {
    backgroundColor: colors.glass[75],
    borderWidth: 1,
    borderColor: colors.glass[95],
    borderRadius: radii.card,
    padding: spacing.sm + 4,
    gap: spacing.sm - 2,
  },
  verdict: {
    color: colors.ink,
    fontSize: fontSizes.title,
    fontWeight: '800',
    lineHeight: 24,
  },
  count: {
    color: colors.accentText,
    fontSize: fontSizes.body,
    fontWeight: '700',
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: fontSizes.body,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.6,
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
});
