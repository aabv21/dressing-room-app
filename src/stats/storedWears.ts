// The last good year of wears, kept on the device so Stats and Diary stay readable offline (spec
// §5.4: "stats and diary stay readable"). One record per user, replaced by every successful fetch.
import { OCCASIONS } from '../closet/catalog';
import { kvGet, kvSet } from '../lib/kv';
import { addDays } from './periods';
import type { WearWithItems } from './wearsRepository';

/** The record's kv key; its `<name>.<id>` shape lets the account cleanup clear it. */
export function storedWearsKey(userId: string): string {
  return `wears.v1.${userId}`;
}

/** The wears with `wornOn` in `[from, to]` (local `YYYY-MM-DD` days), as the last fetch returned them. */
export type StoredWears = { from: string; to: string; wears: WearWithItems[] };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWear(value: unknown): value is WearWithItems {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.wornOn === 'string' &&
    DAY.test(value.wornOn) &&
    (value.occasion === null || OCCASIONS.some((occasion) => occasion === value.occasion)) &&
    (value.score === null || typeof value.score === 'number') &&
    Array.isArray(value.garmentIds) &&
    value.garmentIds.every((id) => typeof id === 'string')
  );
}

/** The stored record, or null when there is none or it doesn't parse. */
export function readStoredWears(userId: string): StoredWears | null {
  const raw = kvGet(storedWearsKey(userId));
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      typeof parsed.from !== 'string' ||
      typeof parsed.to !== 'string' ||
      !Array.isArray(parsed.wears) ||
      !parsed.wears.every(isWear)
    ) {
      return null;
    }
    return { from: parsed.from, to: parsed.to, wears: parsed.wears };
  } catch {
    return null;
  }
}

export function storeWears(userId: string, from: string, to: string, wears: readonly WearWithItems[]): void {
  kvSet(storedWearsKey(userId), JSON.stringify({ from, to, wears }));
}

/**
 * The stored wears with `wornOn` in `[from, to]`, or null when the range starts before the stored
 * one. A range running past `stored.to` is allowed: the days after it simply have nothing stored.
 */
export function wearsInRange(stored: StoredWears, from: string, to: string): WearWithItems[] | null {
  if (from < stored.from) return null;
  return stored.wears.filter((wear) => wear.wornOn >= from && wear.wornOn <= to);
}

/**
 * Folds one fetched range (Diary's month) into the stored record: inside or touching the stored
 * range, its days replace the stored ones and the range grows to cover both; a disjoint range
 * replaces the record only when it is newer, and starts one when nothing is stored.
 */
export function mergeStoredWears(userId: string, from: string, to: string, wears: readonly WearWithItems[]): void {
  const stored = readStoredWears(userId);
  const touches = stored !== null && from <= addDays(stored.to, 1) && to >= addDays(stored.from, -1);
  if (stored === null || !touches) {
    if (stored === null || from > stored.to) storeWears(userId, from, to, wears);
    return;
  }
  // Newest first, like `listWears`: the stored days after the range, the range, the days before it.
  const merged = [
    ...stored.wears.filter((wear) => wear.wornOn > to),
    ...wears,
    ...stored.wears.filter((wear) => wear.wornOn < from),
  ];
  storeWears(userId, from < stored.from ? from : stored.from, to > stored.to ? to : stored.to, merged);
}
