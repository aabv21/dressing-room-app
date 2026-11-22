// The planned outfits on this device, per account in kv `plans.v1.<userId>` (the `<name>.<id>` shape,
// so account deletion clears it): Today, the Plan screen and the reminder read it offline.
import { useMemo, useSyncExternalStore } from 'react';

import { isRecord } from '../../supabase/functions/_shared/guards.ts';
import { OCCASIONS } from '../closet/catalog';
import type { Locale } from '../i18n';
import { kvGet, kvSet, parseJson } from '../lib/kv';
import { addDays } from '../stats/periods';
import type { PlannedOutfit } from './plannedOutfits';

/** Today and the 13 days after it: the planner's window (the database allows a day of slack each way). */
export const PLAN_DAYS = 14;

export function plansKey(userId: string): string {
  return `plans.v1.${userId}`;
}

function isPlan(value: unknown): value is PlannedOutfit {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.day === 'string' &&
    Array.isArray(value.garmentIds) &&
    value.garmentIds.every((id) => typeof id === 'string') &&
    (value.occasion === null || OCCASIONS.some((occasion) => occasion === value.occasion))
  );
}

const isPlanList = (value: unknown): value is PlannedOutfit[] => Array.isArray(value) && value.every(isPlan);

export function planDays(today: string): string[] {
  return Array.from({ length: PLAN_DAYS }, (_, n) => addDays(today, n));
}

/** "Tue, Nov 24" / "mar, 24 nov": a planner day at noon, so no time zone moves it. */
export function formatPlanDay(locale: Locale, day: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${day}T12:00:00`));
}

export function readStoredPlans(userId: string): PlannedOutfit[] {
  return parseJson(kvGet(plansKey(userId)), isPlanList) ?? [];
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Kept by day; every `usePlans` reader re-renders. */
export function storePlans(userId: string, plans: readonly PlannedOutfit[]): void {
  kvSet(plansKey(userId), JSON.stringify([...plans].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))));
  for (const listener of listeners) listener();
}

/** The stored plans, re-read whenever any code writes them. */
export function usePlans(userId: string | null): PlannedOutfit[] {
  const raw = useSyncExternalStore(subscribe, () => (userId === null ? null : kvGet(plansKey(userId))));
  return useMemo(() => parseJson(raw, isPlanList) ?? [], [raw]);
}

export function planFor(plans: readonly PlannedOutfit[], day: string): PlannedOutfit | null {
  return plans.find((plan) => plan.day === day) ?? null;
}
