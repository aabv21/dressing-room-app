// What a `trip-plan` answer must look like to be shown or kept; pure, so the saved-trips repository
// (and its integration test) can use it without the app's kv.
import { isRecord } from '../../supabase/functions/_shared/guards.ts';
import type { TripResponse } from '../../supabase/functions/trip-plan/handler.ts';
import { SLOTS } from '../closet/catalog';

export type { PackingGroup, TripDay, TripResponse } from '../../supabase/functions/trip-plan/handler.ts';

const isSlot = (value: unknown): boolean => SLOTS.some((slot) => slot === value);

const BANDS: readonly unknown[] = ['cold', 'cool', 'mild', 'hot'];
const CONDITIONS: readonly unknown[] = ['clear', 'cloudy', 'fog', 'rain', 'snow', 'storm'];

const isWeather = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.tempC === 'number' &&
  CONDITIONS.includes(value.condition) &&
  BANDS.includes(value.band) &&
  typeof value.rain === 'boolean';

function isDay(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.date === 'string' &&
    (value.weather === null || isWeather(value.weather)) &&
    (value.garmentIds === null || (Array.isArray(value.garmentIds) && value.garmentIds.every((id) => typeof id === 'string')))
  );
}

function isGroup(value: unknown): boolean {
  return (
    isRecord(value) &&
    isSlot(value.slot) &&
    Array.isArray(value.items) &&
    value.items.every((item: unknown) => isRecord(item) && typeof item.garmentId === 'string' && typeof item.days === 'number')
  );
}

/** A plan this app version can render: the answer, and a saved trip's snapshot, are checked with it. */
export function isTripResponse(value: unknown): value is TripResponse {
  if (!isRecord(value)) return false;
  if (value.kind === 'too_small') return Array.isArray(value.missing) && value.missing.every(isSlot);
  return (
    value.kind === 'ok' &&
    typeof value.city === 'string' &&
    Array.isArray(value.days) &&
    value.days.every(isDay) &&
    Array.isArray(value.packing) &&
    value.packing.every(isGroup)
  );
}
