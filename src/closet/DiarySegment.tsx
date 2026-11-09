// The Closet tab's Diary segment (mockup 04 screen 3, spec §3.6): a Monday-first month calendar
// with each worn day's outfit thumbnail, and under it the selected day's wears with their pieces,
// occasion and score. Deleting a wear lowers the pieces' wear counts (a database trigger) and, for
// today's wear, clears Today's "Logged ✓" so the outfit can be logged again.
import { Image } from 'expo-image';
import { useIsFocused } from 'expo-router';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { pluralKey, useI18n, type Locale } from '../i18n';
import type { RequestError } from '../lib/requestResult';
import { localDate } from '../outfits/aiClient';
import { orderPieces } from '../outfits/outfitDisplay';
import { OutfitStack } from '../outfits/OutfitStack';
import { outfitIdentity, unmarkWornToday } from '../outfits/wornToday';
import { monthGrid } from '../stats/periods';
import { diaryByDay } from '../stats/statsModel';
import { deleteWear, listWears, type WearWithItems } from '../stats/wearsRepository';
import { colors, layout, radii, selectionRing, spacing, textScale } from '../ui/theme';
import { slotOf } from './catalog';
import { useCloset } from './ClosetProvider';
import type { Garment } from './garmentRepository';

type Month = { year: number; month: number };
type Cell = { day: string; inMonth: boolean };

const NAV_SIZE = 32;
const NAV_SLOP = (layout.minHitTarget - NAV_SIZE) / 2;
const MINI_HEIGHT = 28;
const MINI_SLOP = (layout.minHitTarget - MINI_HEIGHT) / 2;
// Mockup 04's calendar greys (`.cal .h`, `.d`) and a worn day's darker number (`.d.w`). The light
// grey is the theme's muted ink, the lightest that keeps 4.5:1 on the translucent day cells.
const DAY_MUTED = colors.muted;
const DAY_INK = '#4a4656';

const formats = new Map<string, Intl.DateTimeFormat>();

/** A cached UTC formatter: diary days are calendar dates, so no timezone may shift them. */
function dateFormat(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = formats.get(key);
  if (format === undefined) {
    format = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
    formats.set(key, format);
  }
  return format;
}

function capitalize(text: string): string {
  const [first, ...rest] = text;
  return first === undefined ? text : first.toLocaleUpperCase() + rest.join('');
}

function utcDate(day: string): Date {
  return new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))));
}

/**
 * "October 2026" / "Octubre 2026". The month name and the year are joined by hand: Spanish's
 * month-and-year pattern is "octubre de 2026", while mockup 04 reads "Octubre 2026".
 */
export function formatMonthTitle(locale: Locale, year: number, month: number): string {
  const name = dateFormat(locale, { month: 'long' }).format(new Date(Date.UTC(year, month - 1, 1)));
  return `${capitalize(name)} ${String(year)}`;
}

/** "Wednesday 28" / "Miércoles 28". */
export function formatDayTitle(locale: Locale, day: string): string {
  const weekday = dateFormat(locale, { weekday: 'long' }).format(utcDate(day));
  return `${capitalize(weekday)} ${String(Number(day.slice(8, 10)))}`;
}

function monthOf(day: string): Month {
  return { year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) };
}

function shiftMonth({ year, month }: Month, delta: number): Month {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function monthKey({ year, month }: Month): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/** `monthGrid`'s six weeks without the trailing ones that hold no day of the month. */
function visibleWeeks(cells: readonly Cell[]): Cell[][] {
  const weeks: Cell[][] = [];
  for (let start = 0; start < cells.length; start += 7) {
    const week = cells.slice(start, start + 7);
    if (week.some((cell) => cell.inMonth)) weeks.push(week);
  }
  return weeks;
}

/** The thumbnail piece of a wear: its first top or one-piece in display order, else its first piece. */
function thumbPiece(wear: WearWithItems, byId: ReadonlyMap<string, Garment>): Garment | undefined {
  const pieces = orderPieces(wear.garmentIds.flatMap((id) => byId.get(id) ?? []));
  return (
    pieces.find((g) => g.category !== null && ['top', 'one_piece'].includes(slotOf(g.category))) ?? pieces[0]
  );
}

function DayCell({
  cell,
  today,
  selected,
  thumb,
  thumbUri,
  label,
  onPress,
}: {
  cell: Cell;
  today: boolean;
  selected: boolean;
  thumb: Garment | undefined;
  thumbUri: string | undefined;
  label: string;
  onPress: ((day: string) => void) | undefined;
}): React.JSX.Element {
  const worn = onPress !== undefined;
  const style = [
    styles.cell,
    worn ? styles.cellWorn : null,
    today ? styles.cellToday : null,
    selected ? styles.cellSelected : null,
    cell.inMonth ? null : styles.cellOut,
  ];
  const content = (
    <>
      <Text
        style={[styles.cellNumber, worn ? styles.cellNumberWorn : null, today ? styles.cellNumberToday : null]}
        maxFontSizeMultiplier={textScale.calendar}
      >
        {Number(cell.day.slice(8, 10))}
      </Text>
      {thumb === undefined || thumbUri === undefined ? null : (
        <Image
          testID={`diary-thumb-${cell.day}`}
          source={{ uri: thumbUri, cacheKey: `${thumb.id}:thumb:${String(thumb.photo_version)}` }}
          style={styles.cellThumb}
          cachePolicy="disk"
          contentFit="contain"
          accessibilityIgnoresInvertColors
        />
      )}
    </>
  );
  if (onPress === undefined) {
    return (
      <View
        testID={`diary-cell-${cell.day}`}
        style={style}
        accessible={cell.inMonth}
        accessibilityLabel={label}
        importantForAccessibility={cell.inMonth ? 'yes' : 'no-hide-descendants'}
        accessibilityElementsHidden={!cell.inMonth}
      >
        {content}
      </View>
    );
  }
  return (
    <Pressable
      testID={`diary-cell-${cell.day}`}
      style={style}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={() => {
        onPress(cell.day);
      }}
    >
      {content}
    </Pressable>
  );
}

function WearCard({
  wear,
  title,
  byId,
  thumbUrls,
  busy,
  error,
  onDelete,
}: {
  wear: WearWithItems;
  title: string;
  byId: ReadonlyMap<string, Garment>;
  thumbUrls: Map<string, string>;
  busy: boolean;
  error: RequestError | null;
  onDelete: (wear: WearWithItems) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const pieces = useMemo(() => wear.garmentIds.flatMap((id) => byId.get(id) ?? []), [wear.garmentIds, byId]);
  const meta = [
    wear.occasion === null ? null : t(`occasion.${wear.occasion}`),
    wear.score === null ? null : `${String(wear.score)}%`,
  ]
    .filter((part) => part !== null)
    .join(' · ');
  const deleteLabel = t('diary.delete');
  return (
    <View style={styles.wear} testID={`diary-wear-${wear.id}`}>
      <View style={styles.wearHeader}>
        <Text style={styles.wearTitle} accessibilityRole="header">
          {title}
        </Text>
        {meta === '' ? null : <Text style={styles.muted}>{meta}</Text>}
      </View>
      <OutfitStack garments={pieces} thumbUrls={thumbUrls} compact />
      <View style={styles.wearFooter}>
        {error === null ? null : (
          <Text style={styles.error} accessibilityRole="alert">
            {t(`diary.deleteError.${error}`)}
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={deleteLabel}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          hitSlop={{ top: MINI_SLOP, bottom: MINI_SLOP, left: 4, right: 4 }}
          onPress={() => {
            onDelete(wear);
          }}
          style={[styles.mini, busy ? styles.dimmed : null]}
        >
          <Text style={styles.miniText}>{deleteLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** The Diary segment's body, rendered under the Closet title and segment tabs. */
export function DiarySegment(): React.JSX.Element {
  const { t, locale } = useI18n();
  const { userId } = useAuth();
  const { garments, thumbUrls, refresh } = useCloset();
  const focused = useIsFocused();
  const [today, setToday] = useState(() => localDate());
  const [month, setMonth] = useState<Month>(() => monthOf(today));
  // Keyed by month, so a month switch never shows the previous month's wears in the new grid.
  const [loaded, setLoaded] = useState<{ key: string; wears: WearWithItems[] } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ id: string; error: RequestError } | null>(null);

  const key = monthKey(month);
  const weeks = useMemo(() => visibleWeeks(monthGrid(month.year, month.month)), [month]);
  const lastDay = weeks.flat().filter((cell) => cell.inMonth).at(-1)?.day ?? `${key}-01`;

  // Refetched on focus (a wear logged on Today shows on return), on a month switch and after a delete.
  useEffect(() => {
    if (!focused) {
      return undefined;
    }
    let current = true;
    listWears(`${key}-01`, lastDay).then(
      (wears) => {
        if (current) {
          setToday(localDate());
          setLoaded({ key, wears });
          setFailedKey(null);
        }
      },
      () => {
        if (current) {
          setFailedKey(key);
        }
      },
    );
    return () => {
      current = false;
    };
  }, [focused, key, lastDay, reload]);

  const wears = loaded?.key === key ? loaded.wears : null;
  const failed = failedKey === key;
  const byDay = useMemo(() => diaryByDay(wears ?? []), [wears]);
  const byId = useMemo(() => new Map(garments.map((g) => [g.id, g])), [garments]);
  // Newest first, so the first wear's day is the latest worn one.
  const latestDay = wears?.[0]?.wornOn ?? null;
  const selectedDay = picked !== null && byDay.has(picked) ? picked : latestDay;
  const selectedWears = selectedDay === null ? [] : (byDay.get(selectedDay) ?? []);
  const isCurrentMonth = key >= today.slice(0, 7);

  const goTo = useCallback((delta: number) => {
    setMonth((current) => shiftMonth(current, delta));
    setPicked(null);
    setDeleteError(null);
  }, []);

  const remove = useCallback(
    async (wear: WearWithItems) => {
      setDeletingId(wear.id);
      setDeleteError(null);
      const result = await deleteWear(wear.id);
      setDeletingId(null);
      if (!result.ok) {
        setDeleteError({ id: wear.id, error: result.error });
        return;
      }
      // Today's record holds the outfit, not the wear: keep it while another of today's wears is
      // the same outfit. Today is read at press time, so a diary left open past midnight is right.
      if (userId !== null && wear.wornOn === localDate()) {
        const identity = outfitIdentity(wear.garmentIds);
        const stillWorn = (wears ?? []).some(
          (w) => w.id !== wear.id && w.wornOn === wear.wornOn && outfitIdentity(w.garmentIds) === identity,
        );
        if (!stillWorn) unmarkWornToday(userId, wear.garmentIds);
      }
      setLoaded((prev) => (prev === null ? prev : { key: prev.key, wears: prev.wears.filter((w) => w.id !== wear.id) }));
      setReload((n) => n + 1);
      void refresh();
    },
    [userId, wears, refresh],
  );

  const confirmDelete = useCallback(
    (wear: WearWithItems) => {
      Alert.alert(t('diary.deleteTitle'), t('diary.deleteMessage'), [
        { text: t('diary.cancel'), style: 'cancel' },
        {
          text: t('diary.delete'),
          style: 'destructive',
          onPress: () => {
            void remove(wear);
          },
        },
      ]);
    },
    [t, remove],
  );

  const weekdays = useMemo(() => t('diary.weekdays').split(','), [t]);
  const count = wears?.length ?? 0;
  const prevLabel = t('diary.prev');
  const nextLabel = t('diary.next');

  return (
    <View style={styles.body}>
      <View style={styles.monthRow}>
        <View style={styles.monthNav}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={prevLabel}
            hitSlop={NAV_SLOP}
            onPress={() => {
              goTo(-1);
            }}
            style={styles.navButton}
          >
            <ChevronLeft size={20} color={colors.ink} />
          </Pressable>
          <Text style={styles.monthTitle} accessibilityRole="header">
            {formatMonthTitle(locale, month.year, month.month)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={nextLabel}
            accessibilityState={{ disabled: isCurrentMonth }}
            disabled={isCurrentMonth}
            hitSlop={NAV_SLOP}
            onPress={() => {
              goTo(1);
            }}
            style={[styles.navButton, isCurrentMonth ? styles.dimmed : null]}
          >
            <ChevronRight size={20} color={colors.ink} />
          </Pressable>
        </View>
        {count === 0 ? null : <Text style={styles.muted}>{t(pluralKey('diary.outfits', count), { count })}</Text>}
      </View>

      <View style={styles.calendar}>
        <View style={styles.week} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {weekdays.map((letter, index) => (
            // The letters repeat (M, T … S, S): the position is the identity.
            <Text key={`weekday-${String(index)}`} style={styles.weekday} maxFontSizeMultiplier={textScale.calendar}>
              {letter}
            </Text>
          ))}
        </View>
        {weeks.map((week) => (
          <View key={week[0]?.day} style={styles.week}>
            {week.map((cell) => {
              const dayWears = cell.inMonth ? byDay.get(cell.day) : undefined;
              const latest = dayWears?.[0];
              const thumb = latest === undefined ? undefined : thumbPiece(latest, byId);
              const isToday = cell.day === today;
              const label = [
                dateFormat(locale, { weekday: 'long', month: 'long', day: 'numeric' }).format(utcDate(cell.day)),
                isToday ? t('diary.today') : null,
                dayWears === undefined
                  ? null
                  : t(pluralKey('diary.outfits', dayWears.length), { count: dayWears.length }),
              ]
                .filter((part) => part !== null)
                .join(', ');
              return (
                <DayCell
                  key={cell.day}
                  cell={cell}
                  today={isToday}
                  selected={cell.day === selectedDay}
                  thumb={thumb}
                  thumbUri={thumb === undefined ? undefined : thumbUrls.get(thumb.id)}
                  label={label}
                  onPress={dayWears === undefined ? undefined : setPicked}
                />
              );
            })}
          </View>
        ))}
      </View>

      {failed ? <Text style={styles.error}>{t('stats.error')}</Text> : null}
      {wears === null && !failed ? <ActivityIndicator color={colors.accent} style={styles.loading} /> : null}
      {wears !== null && wears.length === 0 ? <Text style={styles.empty}>{t('diary.empty')}</Text> : null}

      {selectedDay === null
        ? null
        : selectedWears.map((wear) => (
            <WearCard
              key={wear.id}
              wear={wear}
              title={formatDayTitle(locale, selectedDay)}
              byId={byId}
              thumbUrls={thumbUrls}
              busy={deletingId !== null}
              error={deleteError?.id === wear.id ? deleteError.error : null}
              onDelete={confirmDelete}
            />
          ))}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.sm + 2,
  },
  // At a large text size the month title wraps between its arrows and the count goes under it,
  // so the next arrow never leaves the screen.
  monthRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  monthNav: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  navButton: {
    width: NAV_SIZE,
    height: NAV_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
  },
  monthTitle: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '800',
    color: colors.ink,
  },
  calendar: {
    gap: spacing.xs,
  },
  week: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  weekday: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    color: DAY_MUTED,
  },
  cell: {
    flex: 1,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'rgba(255,255,255,0.6)',
    overflow: 'hidden',
  },
  cellWorn: {
    backgroundColor: '#ffffff',
    borderColor: colors.hairline,
  },
  cellToday: {
    borderColor: colors.accent,
  },
  cellSelected: {
    borderWidth: 2,
    borderColor: colors.accent,
    boxShadow: selectionRing,
  },
  cellOut: {
    opacity: 0.35,
  },
  cellNumber: {
    fontSize: 11,
    lineHeight: 13,
    color: DAY_MUTED,
  },
  cellNumberWorn: {
    color: DAY_INK,
    fontWeight: '600',
  },
  cellNumberToday: {
    color: colors.accentText,
    fontWeight: '800',
  },
  cellThumb: {
    width: '58%',
    aspectRatio: 1,
    borderRadius: 6,
  },
  loading: {
    paddingVertical: spacing.md,
  },
  empty: {
    textAlign: 'center',
    fontSize: 13,
    color: colors.muted,
    paddingVertical: spacing.sm,
  },
  wear: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.cell + 2,
    padding: spacing.sm + 4,
    gap: spacing.sm,
  },
  // Wraps the occasion and score under the day when a large text size leaves no room for both.
  wearHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    columnGap: spacing.sm,
  },
  wearTitle: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '800',
    color: colors.ink,
  },
  wearFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  muted: {
    fontSize: 12,
    color: colors.muted,
  },
  error: {
    flexShrink: 1,
    fontSize: 13,
    color: colors.error,
  },
  mini: {
    minHeight: MINI_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm + 4,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: '#ffffff',
  },
  miniText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.error,
  },
  dimmed: {
    opacity: 0.4,
  },
});
