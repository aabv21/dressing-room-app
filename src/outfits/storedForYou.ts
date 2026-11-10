// The last good `for-you` answer per user and language, kept on the device, so For you has
// something to show at once on a cold start, offline, and once the day's quota is spent.
// NOTE: the stored ideas aren't checked against the closet as it is now (an idea bought since stays
// until the next good answer); upgrade path: drop ideas the closet now owns (same category and
// first color, as the function's `ownsArchetype`).
import { GARMENT_CATEGORIES, GARMENT_COLORS } from '../closet/catalog';
import type { Locale } from '../i18n';
import { kvGet, kvSet } from '../lib/kv';
import type { ForYouResponse } from './types';

/** The record's kv key: one per user, holding at most one answer per language. */
export function storedForYouKey(userId: string): string {
  return `forYou.ideas.${userId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isString = (value: unknown): value is string => typeof value === 'string';

function isIdea(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.id) &&
    (GARMENT_CATEGORIES as readonly unknown[]).includes(value.category) &&
    Array.isArray(value.colors) &&
    value.colors.every((color) => (GARMENT_COLORS as readonly unknown[]).includes(color)) &&
    typeof value.newOutfits === 'number' &&
    typeof value.combinesWith === 'number' &&
    (value.line === null || isString(value.line)) &&
    (value.lineKey === null || isString(value.lineKey)) &&
    isRecord(value.lineParams) &&
    Object.values(value.lineParams).every(isString) &&
    isString(value.searchQuery)
  );
}

/** A stored answer this app version can render; anything else (an older shape, a bad write) is dropped. */
function isForYouResponse(value: unknown): value is ForYouResponse {
  if (!isRecord(value)) return false;
  if (value.kind === 'too_small') return true;
  return value.kind === 'ok' && Array.isArray(value.ideas) && value.ideas.every(isIdea);
}

/** The stored record (language → answer), unvalidated: each answer is checked when read. */
function readRecord(userId: string): Record<string, unknown> {
  const raw = kvGet(storedForYouKey(userId));
  if (raw === null) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  return isRecord(value) ? value : {};
}

/** The last good answer `userId` got in `language`, or null. */
export function readStoredForYou(userId: string, language: Locale): ForYouResponse | null {
  const record = readRecord(userId);
  const response = language === 'es' ? record.es : record.en;
  return isForYouResponse(response) ? response : null;
}

/** Keeps `response` as `userId`'s last good answer in `language`, replacing the previous one. */
export function storeForYou(userId: string, language: Locale, response: ForYouResponse): void {
  const record = { ...readRecord(userId), [language]: response };
  kvSet(storedForYouKey(userId), JSON.stringify(record));
}
