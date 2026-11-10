// The last good `lucky-list` answer per occasion, kept on the device for the day, so Today has
// something to show at once on a cold start and stays readable offline (spec §5.4: "today's cached
// suggestion stays readable").
import { OCCASIONS, SLOTS, type Occasion } from '../closet/catalog';
import { kvGet, kvSet } from '../lib/kv';
import type { LuckyResponse } from './types';

/** The record's kv key: one per user, holding only the latest day's lists. */
export function storedLuckyKey(userId: string): string {
  return `today.lucky.${userId}`;
}

/** One occasion's list; `occasion: null` is "no occasion chosen". */
type StoredList = { occasion: Occasion | null; response: LuckyResponse };

type StoredLucky = { day: string; lists: StoredList[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWeather(value: unknown): boolean {
  if (value === null) return true;
  return (
    isRecord(value) &&
    typeof value.tempC === 'number' &&
    typeof value.condition === 'string' &&
    typeof value.band === 'string' &&
    typeof value.rain === 'boolean'
  );
}

function isOutfit(value: unknown): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value.garmentIds) &&
    value.garmentIds.every((id) => typeof id === 'string') &&
    (value.score === null || typeof value.score === 'number') &&
    typeof value.freshThisWeek === 'boolean'
  );
}

/** A stored list this app version can render; anything else (an older shape, a bad write) is dropped. */
function isLuckyResponse(value: unknown): value is LuckyResponse {
  if (!isRecord(value) || !isWeather(value.weather)) return false;
  if (value.kind === 'ok') return Array.isArray(value.outfits) && value.outfits.every(isOutfit);
  if (value.kind === 'too_small') {
    return (
      Array.isArray(value.missing) && value.missing.every((slot) => (SLOTS as readonly unknown[]).includes(slot))
    );
  }
  return false;
}

function isStoredList(value: unknown): value is StoredList {
  return (
    isRecord(value) &&
    (value.occasion === null || OCCASIONS.some((occasion) => occasion === value.occasion)) &&
    isLuckyResponse(value.response)
  );
}

/** The lists stored for `day`, each validated; an earlier day's record counts as none. */
function readDay(userId: string, day: string): StoredList[] {
  const raw = kvGet(storedLuckyKey(userId));
  if (raw === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isRecord(value) || value.day !== day || !Array.isArray(value.lists)) return [];
  return value.lists.filter(isStoredList);
}

/** The last good list `userId` got for `day` and `occasion`, or null. */
export function readStoredLucky(userId: string, day: string, occasion: Occasion | null): LuckyResponse | null {
  return readDay(userId, day).find((list) => list.occasion === occasion)?.response ?? null;
}

/**
 * Keeps `response` as `userId`'s list for `day` and `occasion`. Earlier days' lists are dropped on
 * the way, so the record never holds more than one day (at most one list per occasion).
 */
export function storeLucky(userId: string, day: string, occasion: Occasion | null, response: LuckyResponse): void {
  const others = readDay(userId, day).filter((list) => list.occasion !== occasion);
  const record: StoredLucky = { day, lists: [...others, { occasion, response }] };
  kvSet(storedLuckyKey(userId), JSON.stringify(record));
}
