// Today's "I'll wear it" outfits on the device, so Today and the rating both show "Logged ✓" (also
// after a restart) and the same outfit isn't logged twice.
import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { isRecord } from '../../supabase/functions/_shared/guards.ts';
import { kvGet, kvGetJson, kvSet, parseJson } from '../lib/kv';

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
  return (
    isRecord(value) &&
    typeof value.day === 'string' &&
    Array.isArray(value.outfits) &&
    value.outfits.every((outfit) => typeof outfit === 'string')
  );
}

/** The outfits stored for `day`; an earlier day's record, or one that doesn't parse, counts as none. */
function parse(raw: string | null, day: string): ReadonlySet<string> {
  const value = parseJson(raw, isWornRecord);
  return value !== null && value.day === day ? new Set(value.outfits) : new Set();
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isWornToday(userId: string, day: string, garmentIds: readonly string[]): boolean {
  return parse(kvGet(wornTodayKey(userId)), day).has(outfitIdentity(garmentIds));
}

/** Earlier days' outfits are dropped on the way, so the record never holds more than one day. */
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
 * For a wear deleted from the diary, so "I'll wear it" shows again. The record keeps its day; mounted
 * screens update through the same subscription as a mark.
 */
export function unmarkWornToday(userId: string, garmentIds: readonly string[]): void {
  const key = wornTodayKey(userId);
  const value = kvGetJson(key, isWornRecord);
  if (value === null) return;
  const identity = outfitIdentity(garmentIds);
  if (!value.outfits.includes(identity)) return;
  const record: WornRecord = { day: value.day, outfits: value.outfits.filter((outfit) => outfit !== identity) };
  kvSet(key, JSON.stringify(record));
  for (const listener of listeners) listener();
}

/** Re-read whenever any screen marks an outfit, so one mounted under another (Today under the rating) updates. */
export function useWornToday(day: string): {
  isWorn: (garmentIds: readonly string[]) => boolean;
  markWorn: (garmentIds: readonly string[]) => void;
} {
  const { userId } = useAuth();
  // The raw string is the snapshot, so nothing re-renders until the record really changes.
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
