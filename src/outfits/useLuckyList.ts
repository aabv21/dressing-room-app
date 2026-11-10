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
import { fetchLuckyList, localDate, type AiError, type AiOutcome } from './aiClient';
import { readStoredLucky, storeLucky } from './storedLucky';
import type { LuckyOutfit, LuckyResponse, WeatherSummary } from './types';

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
 * The latest answer for `query`. `failed` is the error of a later fetch for the same query that
 * kept this (good) outcome on screen.
 */
type Settled = { query: string; outcome: AiOutcome<LuckyResponse>; failed: AiError | null };

/**
 * Fetches the list once the closet has loaded (never against a closet still on its way),
 * and again when the occasion or the day changes, when the screen comes back into focus (e.g. after
 * the city modal), after `reload`, and 3 s after the closet last changed in a way the list depends
 * on (a piece put in the laundry, deleted, edited or newly read elsewhere). At most one request is
 * in flight: a trigger during one runs once after it, with the latest occasion and day. The
 * function's cache makes refetches cheap. A refetch keeps the shown outfit while it's still in the
 * list; outfits with a piece that's no longer available are hidden at once, before it lands.
 *
 * Every good answer is stored for the day and occasion. Until this session has one, the stored list
 * is shown (also while the first fetch runs), and a failed fetch keeps it, with `offline` set when
 * the failure was the network.
 */
export function useLuckyList(occasion: Occasion | null): LuckyList {
  const { userId } = useAuth();
  const day = useLocalDay();
  const focused = useIsFocused();
  const { garments, status: closetStatus } = useCloset();
  const closetReady = closetStatus !== 'loading';
  const fingerprint = useMemo(() => closetFingerprint(garments), [garments]);
  const query = `${userId ?? ''}|${day}|${occasion ?? ''}`;

  const [settled, setSettled] = useState<Settled | null>(null);
  // Bumped by `reload`: the effect below fetches again.
  const [attempt, setAttempt] = useState(0);

  // The inputs the next request uses, so a queued one runs with the latest of them. Declared before
  // the fetch effects, so it's up to date when they run in the same commit.
  const latest = useRef({ userId, occasion, day, query, fingerprint });
  useEffect(() => {
    latest.current = { userId, occasion, day, query, fingerprint };
  });
  const inFlight = useRef(false);
  const queued = useRef(false);
  // The closet fingerprint of the last request started; a newer one schedules a refetch.
  const fetchedFingerprint = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(() => {
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    inFlight.current = true;
    // Read through a call: a trigger can set it while the request is awaited.
    const takeQueued = (): boolean => {
      const value = queued.current;
      queued.current = false;
      return value;
    };
    void (async () => {
      do {
        const inputs = latest.current;
        fetchedFingerprint.current = inputs.fingerprint;
        const outcome = await fetchLuckyList({ occasion: inputs.occasion, date: inputs.day });
        if (!mounted.current) return;
        if (outcome.ok && inputs.userId !== null) storeLucky(inputs.userId, inputs.day, inputs.occasion, outcome.result);
        // A failed refetch keeps the list already shown for this query.
        setSettled((previous) =>
          !outcome.ok && previous?.query === inputs.query && previous.outcome.ok
            ? { ...previous, failed: outcome.error }
            : { query: inputs.query, outcome, failed: null },
        );
      } while (takeQueued());
      inFlight.current = false;
    })();
  }, []);

  // Right away: the first load, a new occasion or day, focus regained (off screen nothing is
  // fetched) and `reload`.
  useEffect(() => {
    // `latest` already holds this render's inputs (its effect runs first).
    if (focused && closetReady) run();
  }, [focused, closetReady, query, attempt, run]);

  // Closet changes, debounced.
  useEffect(() => {
    if (!focused || !closetReady || fingerprint === fetchedFingerprint.current) return undefined;
    const timer = setTimeout(run, CLOSET_REFETCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [focused, closetReady, fingerprint, run]);

  const current = settled?.query === query ? settled : null;
  const outcome = current?.outcome ?? null;
  // Today's last good list from an earlier session (or occasion), read again when the query changes;
  // not while the closet loads, since its outfits are filtered against the closet.
  const stored = useMemo(
    () => (userId === null || !closetReady ? null : readStoredLucky(userId, day, occasion)),
    [userId, day, occasion, closetReady],
  );
  let response: LuckyResponse | null = null;
  // The error of the latest fetch when an earlier list is shown instead.
  let failed: AiError | null = null;
  if (outcome?.ok === true) {
    response = outcome.result;
    failed = current?.failed ?? null;
  } else if (stored !== null) {
    response = stored;
    failed = outcome?.ok === false ? outcome.error : null;
  }
  // While another occasion's list loads, the last known weather stays up (it doesn't depend on it).
  const lastResponse = response ?? (settled?.outcome.ok === true ? settled.outcome.result : null);

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

  const reload = useCallback(() => {
    setSettled(null);
    setAttempt((value) => value + 1);
  }, []);

  let state: LuckyState;
  if (response !== null) {
    state = response.kind === 'too_small' ? 'too_small' : 'ready';
  } else if (outcome === null) {
    state = 'loading';
  } else {
    state = 'error';
  }

  return {
    state,
    outfits,
    index,
    next,
    weather: lastResponse?.weather ?? null,
    missing: response?.kind === 'too_small' ? response.missing : [],
    error: response === null && outcome?.ok === false ? outcome.error : null,
    offline: response !== null && failed === 'network',
    reload,
    day,
  };
}
