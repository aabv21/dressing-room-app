// Pure stats derivations for the Stats and Diary segments: everything here is computed from
// garments and wears already in memory, with no I/O and no AI cost (design spec §3.6).

import { PALETTE_HEX, slotOf, type GarmentColor } from '../closet/catalog';
import { COUNTED_COLORS, isActive } from '../closet/closetSelectors';
import type { Garment } from '../closet/garmentRepository';
import { addDays, periodRange, type Period } from './periods';
import type { WearWithItems } from './wearsRepository';

const SIX_MONTHS_DAYS = 182;
const TOP_COLORS = 5;
const MOST_WORN_LIMIT = 5;

/** Garments that count anywhere in Stats, Build, the goal card, colors, balance and the unused list. */
export function activeGarments(garments: readonly Garment[]): Garment[] {
  return garments.filter(isActive);
}

/**
 * Ties within a stat are broken by what the row shows: garments have no name, and a row reads
 * "category · first color", so two pieces of one category still sort by their shown color.
 */
function sortKey(garment: Garment): string {
  return `${garment.category ?? ''}|${garment.colors[0] ?? ''}`;
}

export type Kpis = { wornPct: number; outfits: number; avgScore: number | null; streak: number };

/** Consecutive local days ending today (or yesterday, if there's no wear logged yet today) with at least one wear. */
function streakFrom(daysWithWear: ReadonlySet<string>, today: string): number {
  const start = daysWithWear.has(today) ? today : addDays(today, -1);
  if (!daysWithWear.has(start)) {
    return 0;
  }
  let streak = 0;
  let day = start;
  while (daysWithWear.has(day)) {
    streak += 1;
    day = addDays(day, -1);
  }
  return streak;
}

/**
 * The period's headline numbers. `wears` is every wear this user ever logged (unfiltered): the
 * period's `[from, to]` range (from `periodRange`) scopes `wornPct`, `outfits` and `avgScore`,
 * while the streak looks at the full history so it can count back past the period's start.
 */
export function kpis(garments: readonly Garment[], wears: readonly WearWithItems[], period: Period, today: string): Kpis {
  const { from, to } = periodRange(period, today);
  const inPeriod = wears.filter((w) => w.wornOn >= from && w.wornOn <= to);

  const active = activeGarments(garments);
  const activeIds = new Set(active.map((g) => g.id));
  const wornActiveIds = new Set<string>();
  const scores: number[] = [];
  for (const wear of inPeriod) {
    for (const id of wear.garmentIds) {
      if (activeIds.has(id)) {
        wornActiveIds.add(id);
      }
    }
    if (wear.score !== null) {
      scores.push(wear.score);
    }
  }
  const wornPct = active.length === 0 ? 0 : Math.round((wornActiveIds.size / active.length) * 100);
  const avgScore = scores.length === 0 ? null : Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length);
  const streak = streakFrom(new Set(wears.map((w) => w.wornOn)), today);
  return { wornPct, outfits: inPeriod.length, avgScore, streak };
}

/** The top `limit` active garments by wear count within the period, ties broken by name, descending. */
export function mostWorn(
  garments: readonly Garment[],
  wears: readonly WearWithItems[],
  limit = MOST_WORN_LIMIT,
): { garment: Garment; count: number }[] {
  const active = activeGarments(garments);
  const activeById = new Map(active.map((g) => [g.id, g]));
  const counts = new Map<string, number>();
  for (const wear of wears) {
    for (const id of wear.garmentIds) {
      if (activeById.has(id)) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ garment: activeById.get(id), count }))
    .filter((entry): entry is { garment: Garment; count: number } => entry.garment !== undefined)
    .sort((a, b) => b.count - a.count || sortKey(a.garment).localeCompare(sortKey(b.garment)))
    .slice(0, limit);
}

export type ColorShare = { color: GarmentColor | 'other'; pct: number; hex: string };

const OTHER_HEX = '#d4d0dc';

/**
 * Rounds shares so they sum to 100 (the largest-remainder method): each share gets its floor,
 * then the leftover points go to the entries with the biggest fractional part, largest first.
 */
function roundSharesTo100(counts: readonly number[], total: number): number[] {
  if (total === 0) {
    return counts.map(() => 0);
  }
  const raw = counts.map((count) => (count / total) * 100);
  const floors = raw.map((value) => Math.floor(value));
  let remainder = 100 - floors.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);
  const result = [...floors];
  for (const { index } of order) {
    if (remainder <= 0) break;
    result[index] = (result[index] ?? 0) + 1;
    remainder -= 1;
  }
  return result;
}

/** Each active garment's colors (at most 3), the top 5 by share plus "Other", summing to exactly 100. */
export function colorShares(garments: readonly Garment[]): ColorShare[] {
  const active = activeGarments(garments);
  const counts = new Map<GarmentColor, number>();
  for (const g of active) {
    for (const color of g.colors.slice(0, COUNTED_COLORS)) {
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
  }
  if (counts.size === 0) {
    return [];
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = sorted.slice(0, TOP_COLORS);
  const rest = sorted.slice(TOP_COLORS);
  const otherCount = rest.reduce((sum, [, count]) => sum + count, 0);

  const total = [...top, ...(otherCount > 0 ? [['other', otherCount] as const] : [])];
  const pcts = roundSharesTo100(
    total.map(([, count]) => count),
    total.reduce((sum, [, count]) => sum + count, 0),
  );

  return total.map(([color], index) => ({
    color,
    pct: pcts[index] ?? 0,
    hex: color === 'other' ? OTHER_HEX : PALETTE_HEX[color],
  }));
}

export type SlotBalance = {
  top: number;
  bottom: number;
  shoes: number;
  outerwear: number;
  possible: number;
  insight: { slot: 'top' | 'bottom' | 'shoes'; from: number; to: number } | null;
};

function possibleOutfits(top: number, bottom: number, onePiece: number, shoes: number): number {
  return (top * bottom + onePiece) * shoes;
}

/** Counts by slot (one-pieces counted in top) and the +1 insight among top, bottom and shoes. */
export function slotBalance(garments: readonly Garment[]): SlotBalance {
  const active = activeGarments(garments);
  let top = 0;
  let bottom = 0;
  let onePiece = 0;
  let shoes = 0;
  let outerwear = 0;
  for (const g of active) {
    if (g.category === null) continue;
    switch (slotOf(g.category)) {
      case 'top':
        top += 1;
        break;
      case 'one_piece':
        onePiece += 1;
        break;
      case 'bottom':
        bottom += 1;
        break;
      case 'shoes':
        shoes += 1;
        break;
      case 'outerwear':
        outerwear += 1;
        break;
      default:
        break;
    }
  }

  const possible = possibleOutfits(top, bottom, onePiece, shoes);
  const candidates: { slot: 'top' | 'bottom' | 'shoes'; to: number }[] = [
    { slot: 'top', to: possibleOutfits(top + 1, bottom, onePiece, shoes) },
    { slot: 'bottom', to: possibleOutfits(top, bottom + 1, onePiece, shoes) },
    { slot: 'shoes', to: possibleOutfits(top, bottom, onePiece, shoes + 1) },
  ];
  const best = candidates.reduce((a, b) => (b.to - possible > a.to - possible ? b : a));
  const insight = best.to > possible ? { slot: best.slot, from: possible, to: best.to } : null;

  return { top: top + onePiece, bottom, shoes, outerwear, possible, insight };
}

/** Active garments created more than 6 months ago and not worn in the last 6 months (or never worn). */
export function unusedSixMonths(garments: readonly Garment[], today: string): Garment[] {
  const cutoff = addDays(today, -SIX_MONTHS_DAYS);
  return activeGarments(garments).filter((g) => {
    const createdOn = g.created_at.slice(0, 10);
    const createdOldEnough = createdOn < cutoff;
    const neverOrLongAgo = g.last_worn_at === null || g.last_worn_at.slice(0, 10) < cutoff;
    return createdOldEnough && neverOrLongAgo;
  });
}

/** Groups wears by local day, each day's list kept in the input's (newest-first) order. */
export function diaryByDay(wears: readonly WearWithItems[]): Map<string, WearWithItems[]> {
  const byDay = new Map<string, WearWithItems[]>();
  for (const wear of wears) {
    const list = byDay.get(wear.wornOn);
    if (list === undefined) {
      byDay.set(wear.wornOn, [wear]);
    } else {
      list.push(wear);
    }
  }
  return byDay;
}
