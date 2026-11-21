// The last good year of wears, so Stats and Diary stay readable offline. One record per user.
import { isRecord } from '../../supabase/functions/_shared/guards.ts';
import { OCCASIONS } from '../closet/catalog';
import { kvGetJson, kvSet } from '../lib/kv';
import { addDays } from './periods';
import type { WearWithItems } from './wearsRepository';

/** The record's kv key; its `<name>.<id>` shape lets the account cleanup clear it. */
export function storedWearsKey(userId: string): string {
  return `wears.v1.${userId}`;
}

/** The wears with `wornOn` in `[from, to]` (local `YYYY-MM-DD` days), as the last fetch returned them. */
export type StoredWears = { from: string; to: string; wears: WearWithItems[] };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

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

export function readStoredWears(userId: string): StoredWears | null {
  const parsed = kvGetJson(storedWearsKey(userId), isRecord);
  if (
    parsed === null ||
    typeof parsed.from !== 'string' ||
    typeof parsed.to !== 'string' ||
    !Array.isArray(parsed.wears) ||
    !parsed.wears.every(isWear)
  ) {
    return null;
  }
  return { from: parsed.from, to: parsed.to, wears: parsed.wears };
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
 * Folds a fetched range (Diary's month) in: inside or touching the stored range, its days replace the
 * stored ones and the range grows; a disjoint range replaces the record only when newer.
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
