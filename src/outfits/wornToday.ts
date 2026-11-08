// The outfits logged with "I'll wear it" today, kept on the device so every screen that offers the
// button (Today and the rating) shows "Logged ✓" for them, also after navigating away or a restart.
// Without it each screen only knew its own taps, and the same outfit could be logged twice.
import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { kvGet, kvSet } from '../lib/kv';

/** The record's kv key: one per user, holding only the latest day's outfits. */
export function wornTodayKey(userId: string): string {
  return `outfit.worn.${userId}`;
}

/** An outfit's identity whatever order its pieces come in (Today's list and a swap's ids differ). */
export function outfitIdentity(garmentIds: readonly string[]): string {
  return [...garmentIds].sort().join(',');
}

type WornRecord = { day: string; outfits: string[] };

function isWornRecord(value: unknown): value is WornRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<Record<keyof WornRecord, unknown>>;
  return (
    typeof record.day === 'string' &&
    Array.isArray(record.outfits) &&
    record.outfits.every((outfit) => typeof outfit === 'string')
  );
}

/** The outfits stored for `day`; an earlier day's record, or one that doesn't parse, counts as none. */
function parse(raw: string | null, day: string): ReadonlySet<string> {
  if (raw === null) return new Set();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return new Set();
  }
  return isWornRecord(value) && value.day === day ? new Set(value.outfits) : new Set();
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether `userId` logged the outfit `garmentIds` on `day`. */
export function isWornToday(userId: string, day: string, garmentIds: readonly string[]): boolean {
  return parse(kvGet(wornTodayKey(userId)), day).has(outfitIdentity(garmentIds));
}

/**
 * Records that `userId` logged `garmentIds` on `day`. Earlier days' outfits are dropped on the way,
 * so the record never holds more than one day.
 */
export function markWornToday(userId: string, day: string, garmentIds: readonly string[]): void {
  const key = wornTodayKey(userId);
  const outfits = parse(kvGet(key), day);
  const identity = outfitIdentity(garmentIds);
  if (outfits.has(identity)) return;
  const record: WornRecord = { day, outfits: [...outfits, identity] };
  kvSet(key, JSON.stringify(record));
  for (const listener of listeners) listener();
}

/**
 * The signed-in user's worn-today record for `day`, re-read whenever any screen marks an outfit,
 * so a screen left mounted under another (Today under the rating) updates too.
 */
export function useWornToday(day: string): {
  isWorn: (garmentIds: readonly string[]) => boolean;
  markWorn: (garmentIds: readonly string[]) => void;
} {
  const { userId } = useAuth();
  // The raw stored string is the snapshot: equal strings compare equal, so nothing re-renders until
  // the record really changes.
  const getSnapshot = useCallback(() => (userId === null ? null : kvGet(wornTodayKey(userId))), [userId]);
  const raw = useSyncExternalStore(subscribe, getSnapshot);
  const worn = useMemo(() => parse(raw, day), [raw, day]);

  const isWorn = useCallback((garmentIds: readonly string[]) => worn.has(outfitIdentity(garmentIds)), [worn]);
  const markWorn = useCallback(
    (garmentIds: readonly string[]) => {
      if (userId !== null) markWornToday(userId, day, garmentIds);
    },
    [userId, day],
  );
  return { isWorn, markWorn };
}
