import * as ImagePicker from 'expo-image-picker';
import { router, useIsFocused } from 'expo-router';
import { Camera, ChevronRight, ImageIcon } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ClosetGrid, type LeadingTile } from '../../closet/ClosetGrid';
import { useCloset, usePendingPolling } from '../../closet/ClosetProvider';
import { reviewQueue, slotCounts, toGridItems } from '../../closet/closetSelectors';
import { SLOTS, type Slot } from '../../closet/catalog';
import { CLOSET_GOAL, GoalCard } from '../../closet/GoalCard';
import { perfFixtureItems } from '../../closet/perfFixtureItems';
import { useUploadQueue } from '../../closet/UploadQueueProvider';
import { useNow } from '../../closet/useNow';
import { pluralKey, useI18n } from '../../i18n';
import { PERF_HUD_HEIGHT, PerfHud } from '../../perf/PerfHud';
import { useFrameStats } from '../../perf/useFrameStats';
import type { AnchoredCta } from '../../ui/AnchoredCta';
import { ChipGroup } from '../../ui/ChipGroup';
import { Screen, ScreenTitle, useScreenContentInsets } from '../../ui/Screen';
import { colors, layout, radii, spacing } from '../../ui/theme';

// NOTE: fixture mode is temporary, gated behind `EXPO_PUBLIC_PERF_FIXTURES_URL`, and goes away once
// real garments arrive from Supabase. The env var is set only for the on-device performance gate
// build and never carries a secret — it's just a LAN URL to the fixture server started by
// `pnpm perf:serve`. An empty value counts as unset.
function perfFixturesUrl(): string | undefined {
  const url = process.env.EXPO_PUBLIC_PERF_FIXTURES_URL;
  return url ? url : undefined;
}

const GALLERY_SELECTION_LIMIT = 30;
const CLOCK_TICK_MS = 30_000;
// ChipGroup's chips are 36 pt tall with hitSlop up to the 44 pt minimum.
const CHIP_SLOP = (layout.minHitTarget - 36) / 2;

const noop = (): void => undefined;

// Owns the frame stats so their ~500 ms updates re-render only the HUD, never the list it measures.
function LivePerfHud({ active }: { active: boolean }): React.JSX.Element {
  const { stats, reset } = useFrameStats(active);
  return <PerfHud stats={stats} onReset={reset} />;
}

function PerfFixtureCloset({ baseUrl }: { baseUrl: string }): React.JSX.Element {
  const { t } = useI18n();
  const insets = useScreenContentInsets();
  const items = useMemo(() => perfFixtureItems(baseUrl), [baseUrl]);
  const [scrolling, setScrolling] = useState(false);
  const title = t('screen.closet');
  const header = useMemo(() => <ScreenTitle title={title} />, [title]);
  const contentInset = useMemo(
    () => ({ top: insets.top + PERF_HUD_HEIGHT, bottom: insets.bottom }),
    [insets.top, insets.bottom],
  );

  // Mockup 02's anchored CTA, disabled in fixture mode. It makes the gate screen representative:
  // the CTA's fade sits over the scrolling grid as it does in the real closet.
  const cta = useMemo<React.ComponentProps<typeof AnchoredCta>>(
    () => ({
      secondary: { label: t('closet.gallery'), tone: 'ghost', icon: ImageIcon, onPress: noop, disabled: true },
      primary: { label: t('closet.burstMode'), tone: 'commit', icon: Camera, onPress: noop, disabled: true },
    }),
    [t],
  );

  return (
    <Screen scroll={false} cta={cta}>
      <ClosetGrid
        items={items}
        header={header}
        contentInset={contentInset}
        onScrollActiveChange={setScrolling}
      />
      <LivePerfHud active={scrolling} />
    </Screen>
  );
}

function ReviewBanner({ count }: { count: number }): React.JSX.Element {
  const { t } = useI18n();
  const label = t(pluralKey('closet.reviewBanner', count), { count });
  return (
    <Pressable
      style={styles.banner}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        router.push('/review');
      }}
    >
      <Text style={styles.bannerText}>{label}</Text>
      <ChevronRight size={18} color={colors.accentText} />
    </Pressable>
  );
}

function RealCloset(): React.JSX.Element {
  const { t } = useI18n();
  const insets = useScreenContentInsets();
  const focused = useIsFocused();
  const { garments, thumbUrls, status } = useCloset();
  const queue = useUploadQueue();
  const [filter, setFilter] = useState<Slot | 'all'>('all');
  usePendingPolling(focused);

  // A pending garment joins the review queue once it turns stale (10 minutes), so the clock
  // ticks the banner forward even when the list itself doesn't change.
  const now = useNow(CLOCK_TICK_MS);
  const reviewCount = useMemo(() => reviewQueue(garments, now).length, [garments, now]);

  const counts = useMemo(() => new Map(Object.entries(slotCounts(garments))), [garments]);
  // A filter whose slot just emptied (e.g. its last garment was deleted) falls back to everything.
  const activeFilter = filter !== 'all' && !counts.has(filter) ? 'all' : filter;
  const items = useMemo(
    () => toGridItems(garments, thumbUrls, activeFilter, t),
    [garments, thumbUrls, activeFilter, t],
  );

  const chipOptions = useMemo(() => {
    const options: { value: Slot | 'all'; label: string }[] = [
      { value: 'all', label: t('closet.chip.all', { count: garments.length }) },
    ];
    for (const slot of SLOTS) {
      const count = counts.get(slot);
      if (count !== undefined) {
        options.push({ value: slot, label: t('closet.chip.slot', { label: t(`garment.slot.${slot}`), count }) });
      }
    }
    return options;
  }, [counts, garments.length, t]);

  const onChipChange = useCallback((next: (Slot | 'all')[]) => {
    // Tapping the selected chip clears a single-select ChipGroup; that means "All" here.
    setFilter(next[0] ?? 'all');
  }, []);

  const { retryFailed, discardFailed, enqueue } = queue;
  const showFailedOptions = useCallback(() => {
    Alert.alert(t('closet.failed.title'), t('closet.failed.message'), [
      { text: t('closet.failed.cancel'), style: 'cancel' },
      { text: t('closet.failed.discard'), style: 'destructive', onPress: discardFailed },
      { text: t('closet.failed.retry'), onPress: retryFailed },
    ]);
  }, [t, retryFailed, discardFailed]);

  let leadingTile: LeadingTile | undefined;
  if (queue.pending > 0) {
    leadingTile = { label: t(pluralKey('closet.processing', queue.pending), { count: queue.pending }) };
  } else if (queue.failed > 0) {
    leadingTile = {
      label: t(pluralKey('closet.failed', queue.failed), { count: queue.failed }),
      tone: 'error',
      onPress: showFailedOptions,
    };
  }

  const header = (
    <View style={styles.header}>
      <ScreenTitle title={t('screen.closet')} />
      {status === 'offline' ? <Text style={styles.offline}>{t('closet.offline')}</Text> : null}
      {garments.length < CLOSET_GOAL ? <GoalCard count={garments.length} /> : null}
      {reviewCount > 0 ? <ReviewBanner count={reviewCount} /> : null}
      {garments.length > 0 ? (
        // One row that scrolls sideways, as in mockup 02, rather than wrapping under the header.
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipRow}
          contentContainerStyle={styles.chipRowContent}
        >
          <ChipGroup
            options={chipOptions}
            selected={[activeFilter]}
            onChange={onChipChange}
            multiple={false}
            accessibilityLabel={t('closet.filter')}
          />
        </ScrollView>
      ) : null}
    </View>
  );

  const onPressItem = useCallback((id: string) => {
    router.push(`/garment/${id}`);
  }, []);

  const pickFromGallery = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: GALLERY_SELECTION_LIMIT,
      quality: 1,
    });
    if (result.canceled) {
      return;
    }
    enqueue(result.assets.map((asset) => asset.uri));
  }, [enqueue]);

  const cta = useMemo<React.ComponentProps<typeof AnchoredCta>>(
    () => ({
      secondary: {
        label: t('closet.gallery'),
        tone: 'ghost',
        icon: ImageIcon,
        onPress: () => {
          void pickFromGallery();
        },
      },
      primary: {
        label: t('closet.burstMode'),
        tone: 'commit',
        icon: Camera,
        onPress: () => {
          router.push('/camera');
        },
      },
    }),
    [t, pickFromGallery],
  );

  return (
    <Screen scroll={false} cta={cta}>
      <ClosetGrid
        items={items}
        header={header}
        contentInset={insets}
        onPressItem={onPressItem}
        {...(leadingTile === undefined ? {} : { leadingTile })}
      />
    </Screen>
  );
}

export default function ClosetScreen() {
  const baseUrl = perfFixturesUrl();
  return baseUrl ? <PerfFixtureCloset baseUrl={baseUrl} /> : <RealCloset />;
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.sm + 2,
  },
  // Bleeds to the screen edges so chips scroll out under them, while the first chip still lines up
  // with the title. The vertical padding keeps the chips' 44 pt hitSlop inside the scroll view,
  // which would otherwise clip touches to the 36 pt chip.
  chipRow: {
    marginHorizontal: -spacing.md,
    marginVertical: -CHIP_SLOP,
  },
  chipRowContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: CHIP_SLOP,
  },
  offline: {
    color: colors.muted,
    fontSize: 13,
  },
  banner: {
    minHeight: layout.minHitTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.cell,
    borderWidth: 1,
    borderColor: colors.tintBorder,
    backgroundColor: colors.tint,
  },
  bannerText: {
    flexShrink: 1,
    color: colors.accentText,
    fontSize: 14,
    fontWeight: '700',
  },
});
