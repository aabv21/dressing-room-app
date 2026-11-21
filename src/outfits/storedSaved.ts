// The last good Saved list, so the Closet's Saved segment stays readable offline. One record per user.
import { isRecord } from '../../supabase/functions/_shared/guards.ts';
import { kvGetJson, kvSet } from '../lib/kv';
import type { SavedOutfit } from './savedOutfits';

/** The record's kv key; its `<name>.<id>` shape lets the account cleanup clear it. */
export function storedSavedKey(userId: string): string {
  return `outfits.saved.v1.${userId}`;
}

function isSavedOutfit(value: unknown): value is SavedOutfit {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.savedAt === 'string' &&
    (value.score === null || typeof value.score === 'number') &&
    Array.isArray(value.garmentIds) &&
    value.garmentIds.every((id) => typeof id === 'string')
  );
}

const isSavedList = (value: unknown): value is SavedOutfit[] => Array.isArray(value) && value.every(isSavedOutfit);

export function readStoredSaved(userId: string): SavedOutfit[] | null {
  return kvGetJson(storedSavedKey(userId), isSavedList);
}

export function storeSaved(userId: string, saved: readonly SavedOutfit[]): void {
  kvSet(storedSavedKey(userId), JSON.stringify(saved));
}
