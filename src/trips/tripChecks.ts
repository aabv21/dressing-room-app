// The packing list's check-offs on this device, per account in kv `trip.checks.<userId>` (the
// `<name>.<id>` shape, so account deletion clears it): one entry per trip, the latest 20 kept.
import { useMemo, useSyncExternalStore } from 'react';

import { isRecord } from '../../supabase/functions/_shared/guards.ts';
import type { Occasion } from '../closet/catalog';
import { kvGet, kvSet, parseJson } from '../lib/kv';

export const MAX_CHECKED_TRIPS = 20;

type Checks = Record<string, string[]>;

export function tripChecksKey(userId: string): string {
  return `trip.checks.${userId}`;
}

/** The same trip planned again, or opened from Saved, keeps its check-offs. */
export function tripKey(trip: { city: string; start: string; end: string; occasion: Occasion | null }): string {
  return [trip.city.trim().toLowerCase().replace(/\s+/g, ' '), trip.start, trip.end, trip.occasion ?? ''].join('|');
}

const isChecks = (value: unknown): value is Checks =>
  isRecord(value) && Object.values(value).every((ids) => Array.isArray(ids) && ids.every((id) => typeof id === 'string'));

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Checks or unchecks a garment; the trip moves to the newest entry, and the oldest beyond 20 goes. */
export function toggleChecked(userId: string, trip: string, garmentId: string): void {
  const all = new Map(Object.entries(parseJson(kvGet(tripChecksKey(userId)), isChecks) ?? {}));
  const current = new Set(all.get(trip) ?? []);
  if (current.has(garmentId)) current.delete(garmentId);
  else current.add(garmentId);
  all.delete(trip);
  all.set(trip, [...current]);
  const kept = [...all].slice(-MAX_CHECKED_TRIPS);
  kvSet(tripChecksKey(userId), JSON.stringify(Object.fromEntries(kept)));
  for (const listener of listeners) listener();
}

/** The trip's checked garment ids, re-read on every toggle. */
export function useTripChecks(userId: string | null, trip: string): ReadonlySet<string> {
  const raw = useSyncExternalStore(subscribe, () => (userId === null ? null : kvGet(tripChecksKey(userId))));
  return useMemo(() => new Set(new Map(Object.entries(parseJson(raw, isChecks) ?? {})).get(trip) ?? []), [raw, trip]);
}
