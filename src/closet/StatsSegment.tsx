// The Closet tab's Stats segment (mockup 04 screens 1–2, spec §3.6): period chips, four KPI
// tiles, most worn, colors, closet balance and the unused-for-6-months list. Everything is
// computed on the device from the closet and the wear history; nothing here costs AI.
import { Image } from 'expo-image';
import { router, useIsFocused } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatWearCount, pluralKey, useI18n } from '../i18n';
import type { RequestError } from '../lib/requestResult';
import { localDate } from '../outfits/aiClient';
import { pieceLabel } from '../outfits/outfitDisplay';
import { addDays, daysBetween, periodRange, type Period } from '../stats/periods';
import { colorShares, kpis, mostWorn, slotBalance, unusedSixMonths } from '../stats/statsModel';
import { listWears, type WearWithItems } from '../stats/wearsRepository';
import { HorizontalBars } from '../ui/charts/HorizontalBars';
import { KpiTile } from '../ui/charts/KpiTile';
import { ProportionBar } from '../ui/charts/ProportionBar';
import { ChipGroup } from '../ui/ChipGroup';
import { useLargeText } from '../ui/layout';
import { colors, layout, radii, spacing } from '../ui/theme';
import type { GarmentColor } from './catalog';
import { useCloset } from './ClosetProvider';
import { COUNTED_COLORS, isActive, type ColorFilter } from './closetSelectors';
import { updateGarment, type Garment } from './garmentRepository';

const PERIODS: readonly Period[] = ['week', 'month', 'sixMonths'];
// NOTE: a year of history feeds the streak, so a longer streak reads as 365 days; an unbounded
// fetch on every focus isn't worth it. Upgrade path: a server-side streak count.
// `listWears` pages through the year 1000 wears at a time (PostgREST's `max_rows`), up to 20 pages;
// see its NOTE for the ceiling.
const STREAK_HISTORY_DAYS = 365;
// Room for "100 wears" / "100 usos" at the bars' 12 pt.
const WEARS_VALUE_WIDTH = 62;
const BALANCE_VALUE_WIDTH = 28;
const THUMB_SIZE = 30;
const MINI_HEIGHT = 26;
const MINI_SLOP = (layout.minHitTarget - MINI_HEIGHT) / 2;
// ChipGroup's chips are 36 pt tall with hitSlop up to the 44 pt minimum.
const CHIP_SLOP = (layout.minHitTarget - 36) / 2;

type Translate = ReturnType<typeof useI18n>['t'];

function relativeDay(day: string, today: string, t: Translate): string {
  const days = daysBetween(day, today);
  if (days <= 0) return t('stats.relative.today');
  if (days === 1) return t('stats.relative.yesterday');
  return t('stats.relative.daysAgo', { count: days });
}

/** The newest local day each garment was worn on, from a newest-first wear list. */
function lastWornDays(wears: readonly WearWithItems[]): Map<string, string> {
  const last = new Map<string, string>();
  for (const wear of wears) {
    for (const id of wear.garmentIds) {
      const known = last.get(id);
      if (known === undefined || wear.wornOn > known) {
        last.set(id, wear.wornOn);
      }
    }
  }
  return last;
}

/** Whether lucky-list can use a pin on this garment: it only draws available, categorized pieces. */
function canPin(g: Garment): boolean {
  return g.status === 'available' && g.category !== null;
}

/** The counted colors of the active closet that aren't among `shown` ("Other"'s filter). */
function otherColors(garments: readonly Garment[], shown: ReadonlySet<string>): GarmentColor[] {
  const rest = new Set<GarmentColor>();
  for (const g of garments) {
    if (!isActive(g)) continue;
    for (const color of g.colors.slice(0, COUNTED_COLORS)) {
      if (!shown.has(color)) rest.add(color);
    }
  }
  return [...rest];
}

function Card({ title, aside, children }: { title: string; aside?: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} accessibilityRole="header">
          {title}
        </Text>
        {aside === undefined ? null : <Text style={styles.cardAside}>{aside}</Text>}
      </View>
      {children}
    </View>
  );
}

function UnusedRow({
  garment,
  thumbUri,
  pinned,
  busy,
  onWear,
  onDonate,
}: {
  garment: Garment;
  thumbUri: string | undefined;
  pinned: boolean;
  busy: boolean;
  onWear: (g: Garment) => void;
  onDonate: (g: Garment) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const label = pieceLabel(garment, t);
  const wearLabel = t('stats.unused.wear');
  const donateLabel = t('stats.unused.donate');
  const away = garment.status === 'laundry' || garment.status === 'lent' ? garment.status : null;
  // At the largest text sizes the label gets its own line and the buttons wrap under it, so none
  // of them is pushed off the card.
  const largeText = useLargeText();
  const head = (
    <>
      <View style={styles.thumb}>
        {thumbUri === undefined ? null : (
          <Image
            source={{ uri: thumbUri, cacheKey: `${garment.id}:thumb:${String(garment.photo_version)}` }}
            style={styles.thumbImage}
            contentFit="cover"
            accessibilityIgnoresInvertColors
          />
        )}
      </View>
      <Text style={styles.unusedLabel} {...(largeText ? {} : { numberOfLines: 1 })}>
        {label}
      </Text>
    </>
  );
  return (
    <View style={largeText ? styles.unusedRowStacked : styles.unusedRow} testID={`unused-row-${garment.id}`}>
      {largeText ? <View style={styles.unusedHead}>{head}</View> : head}
      <View style={[styles.minis, largeText ? styles.minisWrap : null]} testID={`unused-minis-${garment.id}`}>
        {/* "Wear it" only where lucky-list will use the pin; a laundry or lent piece shows why not. */}
        {!canPin(garment) ? (
          away === null ? null : (
            <Text style={styles.statusNote}>{t(`garment.status.${away}`)}</Text>
          )
        ) : pinned ? (
          <Text style={styles.pinned}>{t('stats.unused.pinned')}</Text>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${wearLabel}, ${label}`}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            hitSlop={{ top: MINI_SLOP, bottom: MINI_SLOP, left: 2, right: 2 }}
            onPress={() => {
              onWear(garment);
            }}
            style={[styles.mini, busy ? styles.dimmed : null]}
          >
            <Text style={styles.miniText}>{wearLabel}</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${donateLabel}, ${label}`}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          hitSlop={{ top: MINI_SLOP, bottom: MINI_SLOP, left: 2, right: 2 }}
          onPress={() => {
            onDonate(garment);
          }}
          style={[styles.mini, busy ? styles.dimmed : null]}
        >
          <Text style={styles.miniText}>{donateLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * The Stats segment's body, rendered under the Closet title and segment tabs. A color tap hands
 * `onColorSelect` the colors to filter Items by ("Other" stands for every color not shown).
 */
export function StatsSegment({ onColorSelect }: { onColorSelect: (filter: ColorFilter) => void }): React.JSX.Element {
  const { t, locale } = useI18n();
  const { garments, thumbUrls, replaceLocal } = useCloset();
  const focused = useIsFocused();
  const [period, setPeriod] = useState<Period>('month');
  const [today, setToday] = useState(() => localDate());
  const [history, setHistory] = useState<WearWithItems[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<RequestError | null>(null);

  // Fetched once per focus: the streak needs a year back, which covers every period's range too,
  // so a period switch only re-derives from the same history.
  useEffect(() => {
    if (!focused) {
      return undefined;
    }
    let current = true;
    const day = localDate();
    listWears(addDays(day, -STREAK_HISTORY_DAYS), day).then(
      (wears) => {
        if (current) {
          setToday(day);
          setHistory(wears);
          setLoadFailed(false);
        }
      },
      () => {
        if (current) {
          setLoadFailed(true);
        }
      },
    );
    return () => {
      current = false;
    };
  }, [focused]);

  const periodOptions = useMemo(
    () => PERIODS.map((value) => ({ value, label: t(`stats.period.${value}`) })),
    [t],
  );

  const kpi = useMemo(
    () => (history === null ? null : kpis(garments, history, period, today)),
    [garments, history, period, today],
  );

  // Most worn counts only the period's wears (kpis scopes its own).
  const top = useMemo(() => {
    if (history === null) return [];
    const { from, to } = periodRange(period, today);
    return mostWorn(
      garments,
      history.filter((w) => w.wornOn >= from && w.wornOn <= to),
    );
  }, [garments, history, period, today]);
  const lastWorn = useMemo(() => lastWornDays(history ?? []), [history]);

  const barRows = useMemo(
    () =>
      top.map(({ garment, count }) => ({
        id: garment.id,
        label: pieceLabel(garment, t),
        value: count,
        valueLabel: formatWearCount(count, locale),
      })),
    [top, t, locale],
  );
  const selected = top.find((entry) => entry.garment.id === selectedId);
  const selectedLast = selected === undefined ? undefined : lastWorn.get(selected.garment.id);
  const detail =
    selected === undefined || selectedLast === undefined
      ? undefined
      : t('stats.mostWorn.detail', {
          wears: formatWearCount(selected.count, locale),
          relative: relativeDay(selectedLast, today, t),
        });

  const onBarSelect = useCallback(
    (id: string) => {
      if (id === selectedId) {
        router.push(`/garment/${id}`);
        return;
      }
      setSelectedId(id);
    },
    [selectedId],
  );

  const shares = useMemo(() => colorShares(garments), [garments]);
  const segments = useMemo(
    () =>
      shares.map((share) => ({
        id: share.color,
        label: share.color === 'other' ? t('stats.colors.other') : t(`garment.color.${share.color}`),
        pct: share.pct,
        hex: share.hex,
      })),
    [shares, t],
  );
  const onColor = useCallback(
    (id: string) => {
      const share = shares.find((entry) => entry.color === id);
      if (share === undefined) return;
      if (share.color === 'other') {
        onColorSelect({ id: 'other', colors: otherColors(garments, new Set(shares.map((entry) => entry.color))) });
      } else {
        onColorSelect({ id: share.color, colors: [share.color] });
      }
    },
    [shares, garments, onColorSelect],
  );

  const balance = useMemo(() => slotBalance(garments), [garments]);
  const balanceRows = useMemo(
    () =>
      (
        [
          ['top', balance.top],
          ['bottom', balance.bottom],
          ['shoes', balance.shoes],
          ['outerwear', balance.outerwear],
        ] as const
      ).map(([slot, count]) => ({
        id: slot,
        label: t(`stats.balance.${slot}`),
        value: count,
        valueLabel: String(count),
      })),
    [balance, t],
  );

  const tomorrow = addDays(today, 1);
  const unused = useMemo(() => unusedSixMonths(garments, today), [garments, today]);

  // A save commits onto the newest copy of the garment, not the row tapped before the request:
  // a refresh or another edit may have landed while it was in flight.
  const garmentsRef = useRef(garments);
  useEffect(() => {
    garmentsRef.current = garments;
  }, [garments]);
  const latest = useCallback((g: Garment) => garmentsRef.current.find((entry) => entry.id === g.id) ?? g, []);

  const pin = useCallback(
    async (g: Garment) => {
      // "Tomorrow" as of the tap: the screen may have stayed open past midnight.
      const day = localDate();
      setToday(day);
      const target = addDays(day, 1);
      setSaving(true);
      setSaveError(null);
      const result = await updateGarment(g.id, { pinned_on: target });
      setSaving(false);
      if (result.ok) {
        replaceLocal({ ...latest(g), pinned_on: target });
      } else {
        setSaveError(result.error);
      }
    },
    [latest, replaceLocal],
  );

  const donate = useCallback(
    async (g: Garment) => {
      setSaving(true);
      setSaveError(null);
      const result = await updateGarment(g.id, { status: 'donated' });
      setSaving(false);
      if (result.ok) {
        replaceLocal({ ...latest(g), status: 'donated' });
      } else {
        setSaveError(result.error);
      }
    },
    [latest, replaceLocal],
  );

  const confirmDonate = useCallback(
    (g: Garment) => {
      Alert.alert(t('stats.unused.donateTitle'), t('stats.unused.donateMessage'), [
        { text: t('stats.unused.cancel'), style: 'cancel' },
        {
          text: t('stats.unused.donate'),
          style: 'destructive',
          onPress: () => {
            void donate(g);
          },
        },
      ]);
    },
    [t, donate],
  );

  const onWear = useCallback(
    (g: Garment) => {
      void pin(g);
    },
    [pin],
  );

  const insightText =
    balance.insight === null
      ? null
      : t(`stats.balance.insight.${balance.insight.slot}`, { from: balance.insight.from, to: balance.insight.to });

  return (
    <View style={styles.body}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipRow}
        contentContainerStyle={styles.chipRowContent}
      >
        <ChipGroup
          options={periodOptions}
          selected={[period]}
          multiple={false}
          tone="accent"
          wrap={false}
          accessibilityLabel={t('stats.period')}
          onChange={(next) => {
            // Tapping the selected period would clear a single-select ChipGroup: keep it.
            const picked = next[0];
            if (picked !== undefined) {
              setPeriod(picked);
              setSelectedId(null);
            }
          }}
        />
      </ScrollView>

      {loadFailed ? <Text style={styles.error}>{t('stats.error')}</Text> : null}

      {kpi === null ? (
        loadFailed ? null : (
          <ActivityIndicator color={colors.accent} style={styles.loading} />
        )
      ) : (
        <>
          <View style={styles.kpis}>
            <KpiTile value={`${String(kpi.wornPct)}%`} label={t(`stats.kpi.worn.${period}`)} />
            <KpiTile value={String(kpi.outfits)} label={t(pluralKey('stats.kpi.outfits', kpi.outfits))} />
            <KpiTile value={kpi.avgScore === null ? '—' : `${String(kpi.avgScore)}%`} label={t('stats.kpi.score')} />
            <KpiTile
              value={t(pluralKey('stats.kpi.streak', kpi.streak), { count: kpi.streak })}
              label={t('stats.kpi.streakLabel')}
            />
          </View>

          <Card title={t('stats.mostWorn.title')}>
            {barRows.length === 0 ? (
              <Text style={styles.muted}>{t('stats.mostWorn.empty')}</Text>
            ) : (
              <>
                <HorizontalBars
                  rows={barRows}
                  selectedId={selectedId}
                  onSelect={onBarSelect}
                  valueWidth={WEARS_VALUE_WIDTH}
                  {...(detail === undefined ? {} : { detail })}
                />
                <Text style={styles.muted}>{t(`stats.mostWorn.caption.${period}`)}</Text>
              </>
            )}
          </Card>
        </>
      )}

      {segments.length === 0 ? null : (
        <Card title={t('stats.colors.title')} aside={t('stats.colors.hint')}>
          <ProportionBar segments={segments} onSelect={onColor} />
        </Card>
      )}

      <Card title={t('stats.balance.title')}>
        <HorizontalBars rows={balanceRows} valueWidth={BALANCE_VALUE_WIDTH} />
        {insightText === null ? null : (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`${t('stats.balance.tip')} ${insightText} ${t('stats.balance.forYou')}`}
            onPress={() => {
              router.push('/for-you');
            }}
            style={styles.insight}
          >
            <Text style={styles.insightText}>
              <Text style={styles.bold}>{t('stats.balance.tip')}</Text> {insightText}{' '}
              <Text style={styles.link}>{t('stats.balance.forYou')}</Text>
            </Text>
          </Pressable>
        )}
      </Card>

      {unused.length === 0 ? null : (
        <Card title={t('stats.unused.title')} aside={String(unused.length)}>
          {unused.map((g) => (
            <UnusedRow
              key={g.id}
              garment={g}
              thumbUri={thumbUrls.get(g.id)}
              pinned={g.pinned_on === tomorrow}
              busy={saving}
              onWear={onWear}
              onDonate={confirmDonate}
            />
          ))}
          {saveError === null ? null : <Text style={styles.error}>{t(`closet.error.${saveError}`)}</Text>}
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.sm + 2,
  },
  chipRow: {
    marginHorizontal: -spacing.md,
    marginVertical: -CHIP_SLOP,
  },
  chipRowContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: CHIP_SLOP,
  },
  loading: {
    paddingVertical: spacing.lg,
  },
  kpis: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm - 2,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderWidth: 1,
    borderColor: '#ffffff',
    borderRadius: radii.cell + 4,
    padding: spacing.sm + 4,
    gap: spacing.sm,
    boxShadow: '0 6px 18px rgba(60, 30, 120, 0.06)',
  },
  // Wraps the aside under the title when a large text size leaves no room for both.
  cardHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    columnGap: spacing.sm,
  },
  cardTitle: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '800',
    color: colors.ink,
  },
  cardAside: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
  },
  muted: {
    fontSize: 12,
    color: colors.muted,
  },
  error: {
    fontSize: 13,
    color: colors.error,
  },
  insight: {
    minHeight: layout.minHitTarget,
    justifyContent: 'center',
    backgroundColor: colors.tint,
    borderWidth: 1,
    borderColor: colors.tintBorder,
    borderRadius: radii.cell,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
  },
  insightText: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.ink,
  },
  bold: {
    fontWeight: '800',
  },
  link: {
    fontWeight: '700',
    color: colors.accentText,
  },
  unusedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: layout.minHitTarget,
  },
  unusedRowStacked: {
    flexDirection: 'column',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  unusedHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 9,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#eee9f8',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  unusedLabel: {
    flex: 1,
    fontSize: 13,
    color: colors.ink,
  },
  minis: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  minisWrap: {
    flexWrap: 'wrap',
    rowGap: spacing.sm,
  },
  mini: {
    minHeight: MINI_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: '#ffffff',
  },
  miniText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.ink,
  },
  pinned: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '700',
    color: colors.positiveText,
  },
  statusNote: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
  },
  dimmed: {
    opacity: 0.4,
  },
});
