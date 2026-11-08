// Today's "feeling lucky" list: `lucky-list`'s ranked outfits for the day and occasion, walked one
// at a time with "Another", plus the day's occasion kept on the device.
import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { OCCASIONS, type Occasion, type Slot } from '../closet/catalog';
import { useCloset } from '../closet/ClosetProvider';
import type { Garment } from '../closet/garmentRepository';
import { kvGet, kvRemove, kvSet } from '../lib/kv';
import { fetchLuckyList, localDate, type AiError, type AiOutcome } from './aiClient';
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
  const occasion = choice?.key === key ? choice.occasion : readOccasion(userId, day);

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

/**
 * The closet columns `lucky-list`'s cache fingerprint hashes (`lucky-list/handler.ts`; not wear
 * counts or `last_worn_at`, ruling P4-R6): a change here is one the server's list can reflect.
 */
function closetFingerprint(garments: readonly Garment[]): string {
  return JSON.stringify(
    [...garments]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((g) => [g.id, g.category, g.colors, g.pattern, g.formality, g.fit, g.seasons, g.warmth, g.status]),
  );
}

const outfitKey = (outfit: LuckyOutfit): string => outfit.garmentIds.join(',');

type Settled = { query: string; outcome: AiOutcome<LuckyResponse> };

/**
 * Fetches the list on mount, when the occasion or the day changes, when the screen comes back into
 * focus (e.g. after the city modal) and when the closet changes in a way the list depends on (a
 * piece put in the laundry, deleted or edited elsewhere). The function's cache makes those
 * refetches cheap. A refetch keeps the shown outfit while it's still in the list; outfits with a
 * piece that's no longer available are hidden at once, before the refetch lands.
 */
export function useLuckyList(occasion: Occasion | null): LuckyList {
  const day = useLocalDay();
  const focused = useIsFocused();
  const { garments, status: closetStatus } = useCloset();
  const fingerprint = useMemo(() => closetFingerprint(garments), [garments]);
  const query = `${day}|${occasion ?? ''}`;

  const [settled, setSettled] = useState<Settled | null>(null);
  // Bumped by `reload`: the effect below fetches again.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Off screen (another tab, or a modal on top) nothing is fetched; coming back fetches again.
    if (!focused) return undefined;
    let current = true;
    void fetchLuckyList({ occasion, date: day }).then((outcome) => {
      if (!current) return;
      // A failed refetch keeps the list already shown for this query.
      setSettled((previous) =>
        !outcome.ok && previous?.query === query && previous.outcome.ok ? previous : { query, outcome },
      );
    });
    return () => {
      current = false;
    };
  }, [focused, query, occasion, day, fingerprint, attempt]);

  const outcome = settled?.query === query ? settled.outcome : null;
  const response = outcome?.ok === true ? outcome.result : null;
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
  if (outcome === null) {
    state = 'loading';
  } else if (!outcome.ok) {
    state = 'error';
  } else if (outcome.result.kind === 'too_small') {
    state = 'too_small';
  } else if (outfits.length === 0 && outcome.result.outfits.length > 0 && closetStatus === 'loading') {
    // A first launch's closet is still on its way: the pieces can't be resolved yet.
    state = 'loading';
  } else {
    state = 'ready';
  }

  return {
    state,
    outfits,
    index,
    next,
    weather: lastResponse?.weather ?? null,
    missing: response?.kind === 'too_small' ? response.missing : [],
    error: outcome?.ok === false ? outcome.error : null,
    reload,
    day,
  };
}
