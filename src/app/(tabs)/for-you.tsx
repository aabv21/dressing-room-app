// For you (spec §3.7): 3–5 "what you're missing" ideas from the `for-you` function, each with how
// many of the user's pieces it combines with, a line (Claude's, or a template rendered here) and
// "Search in stores", which opens a web search for it in the system browser. Cards follow mockups
// 01 and 04 (white rounded cards, accent pills).
import { router } from 'expo-router';
import { RotateCw, Search, Shirt, Sparkles, TriangleAlert, WifiOff } from 'lucide-react-native';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { PALETTE_HEX } from '../../closet/catalog';
import { isMessageKey, pluralKey, useI18n, type Locale } from '../../i18n';
import type { AiError } from '../../outfits/aiClient';
import { pieceLabel } from '../../outfits/outfitDisplay';
import type { ForYouCard } from '../../outfits/types';
import { useForYou } from '../../outfits/useForYou';
import type { CtaAction } from '../../ui/AnchoredCta';
import { Screen } from '../../ui/Screen';
import { colors, layout, radii, spacing } from '../../ui/theme';

type Translate = ReturnType<typeof useI18n>['t'];

const SEARCH_HEIGHT = 40;
const SWATCH_HEX = new Map(Object.entries(PALETTE_HEX));

/** The Google search for an idea, in the app's language (global constraints' "Store search"). */
function storeSearchUrl(searchQuery: string, locale: Locale): string {
  return `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}&hl=${locale}`;
}

/** Claude's line, else the template key rendered here; null for a key this app version doesn't know. */
function lineText(idea: ForYouCard, t: Translate): string | null {
  if (idea.line !== null) return idea.line;
  if (idea.lineKey === null || !isMessageKey(idea.lineKey)) return null;
  return t(idea.lineKey, idea.lineParams);
}

/** The function's errors the screen has copy for; the rest read as "unknown". */
function errorCopy(error: AiError): 'over_quota' | 'network' | 'unavailable' | 'unknown' {
  return error === 'over_quota' || error === 'network' || error === 'unavailable' ? error : 'unknown';
}

function IdeaCard({ idea }: { idea: ForYouCard }): React.JSX.Element {
  const { t, locale } = useI18n();
  const name = pieceLabel(idea, t);
  const line = lineText(idea, t);
  const swatch = idea.colors[0] === undefined ? undefined : SWATCH_HEX.get(idea.colors[0]);
  const search = t('forYou.search');
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View
          style={[styles.swatch, swatch === undefined ? null : { backgroundColor: swatch }]}
          importantForAccessibility="no"
          accessibilityElementsHidden
        />
        <Text style={styles.name}>{name}</Text>
      </View>
      <Text style={styles.combines}>
        {t('forYou.combines', { n: idea.combinesWith })}{' '}
        <Text style={styles.gain}>{t(pluralKey('forYou.outfits', idea.newOutfits), { count: idea.newOutfits })}</Text>
      </Text>
      {line === null ? null : <Text style={styles.line}>{line}</Text>}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${search}, ${name}`}
        hitSlop={{ top: (layout.minHitTarget - SEARCH_HEIGHT) / 2, bottom: (layout.minHitTarget - SEARCH_HEIGHT) / 2 }}
        onPress={() => {
          // NOTE: a device with no browser rejects; nothing else can open the search, so it's dropped.
          Linking.openURL(storeSearchUrl(idea.searchQuery, locale)).catch(() => undefined);
        }}
        style={({ pressed }) => [styles.search, pressed ? styles.pressed : null]}
      >
        <Search size={14} color={colors.accentText} strokeWidth={2.5} />
        <Text style={styles.searchLabel}>{search}</Text>
      </Pressable>
    </View>
  );
}

function LoadingCards(): React.JSX.Element {
  const { t } = useI18n();
  return (
    <View style={styles.cards} accessible accessibilityLabel={t('forYou.loading')} accessibilityLiveRegion="polite">
      {[0, 1, 2].map((row) => (
        <View key={row} style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={[styles.swatch, styles.placeholderSwatch]} />
            <View style={[styles.placeholderBar, styles.placeholderWide]} />
          </View>
          <View style={styles.placeholderBar} />
          <View style={[styles.placeholderBar, styles.placeholderFull]} />
        </View>
      ))}
    </View>
  );
}

/** A small line above the cards when they're the last good ones, because the latest fetch failed. */
function Note({ error }: { error: AiError }): React.JSX.Element {
  const { t } = useI18n();
  let Icon = TriangleAlert;
  let text = t('forYou.note.failed');
  if (error === 'network') {
    Icon = WifiOff;
    text = t('forYou.offline');
  } else if (error === 'over_quota') {
    Icon = Sparkles;
    text = t('forYou.note.over_quota');
  }
  return (
    <View style={styles.note} accessible accessibilityLiveRegion="polite">
      <Icon size={13} color={colors.muted} />
      <Text style={styles.noteText}>{text}</Text>
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

export default function ForYouScreen(): React.JSX.Element {
  const { t } = useI18n();
  const forYou = useForYou();

  let body: React.ReactNode;
  let primary: CtaAction | undefined;
  if (forYou.state === 'loading') {
    body = <LoadingCards />;
  } else if (forYou.state === 'error') {
    const error = errorCopy(forYou.error ?? 'unknown');
    body = <Message>{t(`forYou.error.${error}`)}</Message>;
    // Over quota can't succeed again today, so there's no retry.
    if (error !== 'over_quota') {
      primary = { label: t('forYou.retry'), tone: 'commit', icon: RotateCw, onPress: forYou.reload };
    }
  } else if (forYou.state === 'too_small') {
    body = <Message>{t('forYou.tooSmall')}</Message>;
    primary = {
      label: t('forYou.tooSmall.cta'),
      tone: 'commit',
      icon: Shirt,
      onPress: () => {
        router.push('/closet');
      },
    };
  } else if (forYou.ideas.length === 0) {
    body = <Message>{t('forYou.empty')}</Message>;
  } else {
    body = (
      <View style={styles.cards}>
        {forYou.ideas.map((idea) => (
          <IdeaCard key={idea.id} idea={idea} />
        ))}
      </View>
    );
  }

  return (
    <Screen title={t('screen.forYou')} {...(primary === undefined ? {} : { cta: { primary } })}>
      <Text style={styles.intro}>{t('forYou.intro')}</Text>
      {forYou.failed === null ? null : <Note error={forYou.failed} />}
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: -2,
  },
  cards: {
    gap: spacing.sm + 2,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderWidth: 1,
    borderColor: '#ffffff',
    borderRadius: radii.cell + 4,
    padding: spacing.sm + 4,
    gap: spacing.sm - 2,
    boxShadow: '0 6px 18px rgba(60, 30, 120, 0.06)',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
  },
  swatch: {
    width: 30,
    height: 30,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
    backgroundColor: '#ffffff',
  },
  name: {
    flex: 1,
    color: colors.ink,
    fontSize: 15,
    fontWeight: '800',
  },
  combines: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  gain: {
    color: colors.accentText,
    fontWeight: '700',
  },
  line: {
    color: '#4a4656',
    fontSize: 14,
    lineHeight: 19,
  },
  search: {
    minHeight: SEARCH_HEIGHT,
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: '#e3d8ff',
    backgroundColor: '#ffffff',
  },
  pressed: {
    backgroundColor: colors.tint,
  },
  searchLabel: {
    color: colors.accentText,
    fontSize: 13,
    fontWeight: '700',
  },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 2,
  },
  noteText: {
    flex: 1,
    color: colors.muted,
    fontSize: 13,
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
  placeholderSwatch: {
    backgroundColor: colors.tint,
    borderColor: colors.tint,
  },
  placeholderBar: {
    height: 10,
    width: '45%',
    borderRadius: 5,
    backgroundColor: colors.track,
  },
  placeholderWide: {
    width: '50%',
    height: 12,
  },
  placeholderFull: {
    width: '90%',
  },
});
