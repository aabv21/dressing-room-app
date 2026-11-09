import * as ImagePicker from 'expo-image-picker';
import { router, useIsFocused } from 'expo-router';
import { Camera, ChevronRight, ImageIcon, X } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ClosetGrid, type LeadingTile } from '../../closet/ClosetGrid';
import { useCloset, usePendingPolling } from '../../closet/ClosetProvider';
import {
  hasAnyColor,
  isActive,
  reviewQueue,
  slotCounts,
  toGridItems,
  type ColorFilter,
} from '../../closet/closetSelectors';
import { PALETTE_HEX, SLOTS, type Slot } from '../../closet/catalog';
import { SegmentTabs } from '../../closet/SegmentTabs';
import { StatsSegment } from '../../closet/StatsSegment';
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

type Segment = 'items' | 'stats' | 'diary';

const SEGMENTS: readonly Segment[] = ['items', 'stats', 'diary'];
const OTHER_SWATCH = '#d4d0dc';

/** Mockup 04's segment pills under the Closet title. */
function ClosetTabs({ value, onChange }: { value: Segment; onChange: (next: Segment) => void }): React.JSX.Element {
  const { t } = useI18n();
  const options = useMemo(() => SEGMENTS.map((segment) => ({ value: segment, label: t(`closet.segment.${segment}`) })), [t]);
  return <SegmentTabs options={options} value={value} onChange={onChange} accessibilityLabel={t('closet.segments')} />;
}

/** The Items segment's dismissible chip for Stats' color filter. */
function ColorFilterChip({ filter, onClear }: { filter: ColorFilter; onClear: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const label = filter.id === 'other' ? t('stats.colors.other') : t(`garment.color.${filter.id}`);
  const swatch = filter.id === 'other' ? OTHER_SWATCH : PALETTE_HEX[filter.id];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('closet.colorFilter.clear', { color: label })}
      hitSlop={CHIP_SLOP}
      onPress={onClear}
      style={styles.colorChip}
    >
      <View style={[styles.colorSwatch, { backgroundColor: swatch }]} />
      <Text style={styles.colorChipText}>{label}</Text>
      <X size={14} color={colors.accentText} />
    </Pressable>
  );
}

function ItemsSegment({
  tabs,
  colorFilter,
  onClearColor,
}: {
  tabs: React.ReactNode;
  colorFilter: ColorFilter | null;
  onClearColor: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const insets = useScreenContentInsets();
  const { garments, thumbUrls, status } = useCloset();
  const queue = useUploadQueue();
  const [filter, setFilter] = useState<Slot | 'all'>('all');

  // A pending garment joins the review queue once it turns stale (10 minutes), so the clock
  // ticks the banner forward even when the list itself doesn't change.
  const now = useNow(CLOCK_TICK_MS);
  const reviewCount = useMemo(() => reviewQueue(garments, now).length, [garments, now]);

  const activeCount = useMemo(() => garments.filter(isActive).length, [garments]);
  const colorSet = useMemo(() => (colorFilter === null ? undefined : new Set(colorFilter.colors)), [colorFilter]);
  // The chips count what the color filter leaves, so "All" matches the grid.
  const visible = useMemo(
    () => (colorSet === undefined ? garments : garments.filter((g) => hasAnyColor(g, colorSet))),
    [garments, colorSet],
  );
  const visibleCount = useMemo(() => visible.filter(isActive).length, [visible]);
  const counts = useMemo(() => new Map(Object.entries(slotCounts(visible))), [visible]);
  // A filter whose slot just emptied (e.g. its last garment was deleted) falls back to everything.
  const activeFilter = filter !== 'all' && !counts.has(filter) ? 'all' : filter;
  const items = useMemo(
    () => toGridItems(garments, thumbUrls, activeFilter, t, colorSet),
    [garments, thumbUrls, activeFilter, t, colorSet],
  );

  const chipOptions = useMemo(() => {
    const options: { value: Slot | 'all'; label: string }[] = [
      { value: 'all', label: t('closet.chip.all', { count: visibleCount }) },
    ];
    for (const slot of SLOTS) {
      const count = counts.get(slot);
      if (count !== undefined) {
        options.push({ value: slot, label: t('closet.chip.slot', { label: t(`garment.slot.${slot}`), count }) });
      }
    }
    return options;
  }, [counts, visibleCount, t]);

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

  const { pending, failed } = queue;
  const leadingTile = useMemo<LeadingTile | undefined>(() => {
    if (pending > 0) {
      return { label: t(pluralKey('closet.processing', pending), { count: pending }) };
    }
    if (failed > 0) {
      return { label: t(pluralKey('closet.failed', failed), { count: failed }), tone: 'error', onPress: showFailedOptions };
    }
    return undefined;
  }, [pending, failed, t, showFailedOptions]);

  const header = (
    <View style={styles.header}>
      <ScreenTitle title={t('screen.closet')} />
      {tabs}
      {status === 'offline' ? <Text style={styles.offline}>{t('closet.offline')}</Text> : null}
      {activeCount < CLOSET_GOAL ? <GoalCard count={activeCount} /> : null}
      {reviewCount > 0 ? <ReviewBanner count={reviewCount} /> : null}
      {colorFilter === null ? null : <ColorFilterChip filter={colorFilter} onClear={onClearColor} />}
      {activeCount > 0 ? (
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

/** Mockup 04: the Closet tab's Items | Stats | Diary segments, each under the same title and pills. */
function RealCloset(): React.JSX.Element {
  const { t } = useI18n();
  const focused = useIsFocused();
  const [segment, setSegment] = useState<Segment>('items');
  const [colorFilter, setColorFilter] = useState<ColorFilter | null>(null);
  // Polls pending extractions whichever segment shows, so Items is current on return.
  usePendingPolling(focused);

  const onColorSelect = useCallback((next: ColorFilter) => {
    setColorFilter(next);
    setSegment('items');
  }, []);
  const clearColor = useCallback(() => {
    setColorFilter(null);
  }, []);

  const tabs = <ClosetTabs value={segment} onChange={setSegment} />;

  if (segment === 'items') {
    return <ItemsSegment tabs={tabs} colorFilter={colorFilter} onClearColor={clearColor} />;
  }
  return (
    <Screen title={t('screen.closet')}>
      <View style={styles.segmentBody}>
        {tabs}
        {segment === 'stats' ? (
          <StatsSegment onColorSelect={onColorSelect} />
        ) : (
          // A placeholder until the Diary segment's month calendar replaces it.
          <Text style={styles.offline}>{t('diary.comingSoon')}</Text>
        )}
      </View>
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
  // Screen's own 8 pt gap sits between the title and this block; the rest matches Items' header.
  segmentBody: {
    gap: spacing.sm + 2,
  },
  colorChip: {
    alignSelf: 'flex-start',
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.tintBorder,
    backgroundColor: colors.tint,
  },
  colorSwatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.15)',
  },
  colorChipText: {
    color: colors.accentText,
    fontSize: 13,
    fontWeight: '700',
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
