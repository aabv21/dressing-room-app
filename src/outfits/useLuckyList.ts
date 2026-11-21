// Today's "feeling lucky" list: `lucky-list`'s ranked outfits for the day and occasion, walked one
// at a time with "Another", plus the day's occasion kept on the device. The last good list per
// occasion is kept on the device too (`storedLucky.ts`), so Today is readable offline.
import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { OCCASIONS, type Occasion, type Slot } from '../closet/catalog';
import { useCloset } from '../closet/ClosetProvider';
import type { Garment } from '../closet/garmentRepository';
import { kvGet, kvRemove, kvSet } from '../lib/kv';
import { localDate } from '../lib/localDate';
import { fetchLuckyList, type AiError } from './aiClient';
import { readStoredLucky, storeLucky } from './storedLucky';
import type { LuckyOutfit, LuckyResponse, WeatherSummary } from './types';
import { useStoredQuery } from './useStoredQuery';

export type LuckyState = 'loading' | 'ready' | 'too_small' | 'error';

export type LuckyList = {
  state: LuckyState;
  /** The day's outfits whose every piece is still in the closet and available. */
  outfits: LuckyOutfit[];
  /** The shown outfit's position in `outfits` (0 when the list is empty). */
  index: number;
  /** Shows the next outfit, wrapping after the last. */
  next: () => void;
  weather: WeatherSummary | null;
  /** The slots a `too_small` closet lacks; empty otherwise. */
  missing: Slot[];
  error: AiError | null;
  /**
   * The list shown is the last one that came back (now or earlier today), because the latest fetch
   * couldn't connect.
   */
  offline: boolean;
  /** The error of the latest fetch when an earlier list is shown instead; null when it succeeded. */
  refetchError: AiError | null;
  /** Fetches again after an error. */
  reload: () => void;
  /** The local day the list is for (`localDate()`, re-read on returning to the foreground). */
  day: string;
};

/** The device's local day, re-read whenever the app returns to the foreground. */
export function useLocalDay(): string {
  const [day, setDay] = useState(() => localDate());
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setDay(localDate());
    });
    return () => {
      subscription.remove();
    };
  }, []);
  return day;
}

function occasionKey(userId: string, day: string): string {
  return `today.occasion.${userId}.${day}`;
}

function readOccasion(userId: string | null, day: string): Occasion | null {
  if (userId === null) return null;
  const stored = kvGet(occasionKey(userId, day));
  return OCCASIONS.find((occasion) => occasion === stored) ?? null;
}

/**
 * The occasion chosen for today, kept in kv under `today.occasion.<userId>.<date>`, so it survives a
 * restart and starts empty the next day.
 * NOTE: past days' keys are never removed (one short row per day used); upgrade path: drop other
 * days' keys on write if the kv store ever needs trimming.
 */
export function useTodayOccasion(): [Occasion | null, (next: Occasion | null) => void] {
  const { userId } = useAuth();
  const day = useLocalDay();
  const [choice, setChoice] = useState<{ key: string; occasion: Occasion | null } | null>(null);
  const key = `${userId ?? ''}|${day}`;
  const stored = useMemo(() => readOccasion(userId, day), [userId, day]);
  const occasion = choice?.key === key ? choice.occasion : stored;

  const choose = useCallback(
    (next: Occasion | null) => {
      if (userId !== null) {
        if (next === null) kvRemove(occasionKey(userId, day));
        else kvSet(occasionKey(userId, day), next);
      }
      setChoice({ key, occasion: next });
    },
    [userId, day, key],
  );
  return [occasion, choose];
}

/** How long closet changes settle before they refetch the list: an upload burst is one call. */
export const CLOSET_REFETCH_DELAY_MS = 3_000;

/**
 * `lucky-list`'s cache fingerprint (`lucky-list/handler.ts`): the candidate garments (a category
 * and `available`) and their rating columns, not wear counts or `last_worn_at` (logging a wear
 * bumps them, and wearing an outfit mustn't reshuffle today's list). A change here is one the
 * server's list can reflect.
 */
function closetFingerprint(garments: readonly Garment[]): string {
  return JSON.stringify(
    garments
      .filter((g) => g.category !== null && g.status === 'available')
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((g) => [g.id, g.category, g.colors, g.pattern, g.formality, g.fit, g.seasons, g.warmth, g.status]),
  );
}

const outfitKey = (outfit: LuckyOutfit): string => outfit.garmentIds.join(',');

/**
 * Fetches the list once the closet has loaded (never against a closet still on its way), and again
 * when the occasion or the day changes, when the screen comes back into focus (e.g. after the city
 * modal), after `reload`, and 3 s after the closet last changed in a way the list depends on. A
 * refetch keeps the shown outfit while it's still in the list; outfits with a piece that's no
 * longer available are hidden at once, before it lands.
 */
export function useLuckyList(occasion: Occasion | null): LuckyList {
  const { userId } = useAuth();
  const day = useLocalDay();
  const focused = useIsFocused();
  const { garments, status: closetStatus } = useCloset();
  const closetReady = closetStatus !== 'loading';
  const fingerprint = useMemo(() => closetFingerprint(garments), [garments]);
  const query = `${userId ?? ''}|${day}|${occasion ?? ''}`;

  // The closet fingerprint of the last request started; a newer one schedules a refetch.
  const fetchedFingerprint = useRef<string | null>(null);
  const latestFingerprint = useRef(fingerprint);
  useEffect(() => {
    latestFingerprint.current = fingerprint;
  });

  // Not while the closet loads: the stored outfits are filtered against it.
  const readStored = useCallback(
    () => (userId === null || !closetReady ? null : readStoredLucky(userId, day, occasion)),
    [userId, day, occasion, closetReady],
  );
  const { data: response, status, error, reload, refetch, lastData } = useStoredQuery<LuckyResponse>({
    key: query,
    enabled: focused && closetReady,
    fetch: () => {
      fetchedFingerprint.current = fingerprint;
      return fetchLuckyList({ occasion, date: day });
    },
    readStored,
    store: (result) => {
      if (userId !== null) storeLucky(userId, day, occasion, result);
    },
  });

  // Closet changes, debounced.
  useEffect(() => {
    if (!focused || !closetReady || fingerprint === fetchedFingerprint.current) return undefined;
    // Another trigger (focus, occasion) may fetch this same closet before the delay ends.
    const timer = setTimeout(() => {
      if (latestFingerprint.current !== fetchedFingerprint.current) refetch();
    }, CLOSET_REFETCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [focused, closetReady, fingerprint, refetch]);

  // While another occasion's list loads, the last known weather stays up (it doesn't depend on it).
  const lastResponse = response ?? lastData;

  const outfits = useMemo(() => {
    if (response?.kind !== 'ok') return [];
    const byId = new Map(garments.map((g) => [g.id, g]));
    return response.outfits.filter((outfit) => outfit.garmentIds.every((id) => byId.get(id)?.status === 'available'));
  }, [response, garments]);

  // The shown outfit, by its ids, so a refetch that still lists it keeps it on screen.
  const [shown, setShown] = useState<{ query: string; key: string } | null>(null);
  const found = shown?.query === query ? outfits.findIndex((outfit) => outfitKey(outfit) === shown.key) : -1;
  const index = Math.max(found, 0);

  const next = useCallback(() => {
    const following = outfits[(index + 1) % Math.max(outfits.length, 1)];
    if (following !== undefined) setShown({ query, key: outfitKey(following) });
  }, [outfits, index, query]);

  let state: LuckyState;
  if (response !== null) state = response.kind === 'too_small' ? 'too_small' : 'ready';
  else state = status === 'loading' ? 'loading' : 'error';

  return {
    state,
    outfits,
    index,
    next,
    weather: lastResponse?.weather ?? null,
    missing: response?.kind === 'too_small' ? response.missing : [],
    error: response === null ? error : null,
    offline: status === 'offline',
    refetchError: response === null ? null : error,
    reload,
    day,
  };
}
