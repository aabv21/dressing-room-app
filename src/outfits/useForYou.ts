// For you's ideas: `for-you`'s answer in the app's language, with the last good one kept on the
// device (`storedForYou.ts`), so the tab is readable offline and once the day's quota is spent.
import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { useI18n } from '../i18n';
import { fetchForYou, type AiError, type AiOutcome } from './aiClient';
import { readStoredForYou, storeForYou } from './storedForYou';
import type { ForYouCard, ForYouResponse } from './types';

export type ForYouState = 'loading' | 'ready' | 'too_small' | 'error';

export type ForYouIdeas = {
  state: ForYouState;
  /** The ideas shown; empty unless `state` is `ready` (and possibly then, when none came up). */
  ideas: ForYouCard[];
  /** Why there's nothing to show (`state` is `error`). */
  error: AiError | null;
  /** The latest fetch failed with this, and the ideas shown are the last good ones. */
  failed: AiError | null;
  /** Fetches again after an error. */
  reload: () => void;
};

/**
 * The latest answer for `query` (user and language). `failed` is the error of a later fetch for
 * the same query that kept this (good) outcome on screen.
 */
type Settled = { query: string; outcome: AiOutcome<ForYouResponse>; failed: AiError | null };

/**
 * Fetches the ideas when the tab is focused (so a closet change made elsewhere is picked up on
 * return), when the language changes, and after `reload`. At most one request is in flight: a
 * second concurrent call would spend the day's single For you quota twice and get a 429 (the
 * function caches only once the first one finishes), so a trigger during one runs once after it.
 * The function's cache makes these refetches cheap.
 *
 * Every good answer is stored. Until this session has one, the stored answer is shown (also while
 * the first fetch runs), and a failed fetch keeps it on screen with `failed` set.
 */
export function useForYou(): ForYouIdeas {
  const { userId } = useAuth();
  const { locale } = useI18n();
  const focused = useIsFocused();
  const query = `${userId ?? ''}|${locale}`;

  const [settled, setSettled] = useState<Settled | null>(null);
  // Bumped by `reload`: the effect below fetches again.
  const [attempt, setAttempt] = useState(0);

  // The inputs the next request uses, so a queued one runs with the latest of them.
  const latest = useRef({ userId, locale, query });
  useEffect(() => {
    latest.current = { userId, locale, query };
  });
  const inFlight = useRef(false);
  const queued = useRef(false);
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
        const outcome = await fetchForYou({ language: inputs.locale });
        if (!mounted.current) return;
        if (outcome.ok && inputs.userId !== null) storeForYou(inputs.userId, inputs.locale, outcome.result);
        // A failed refetch keeps the ideas already shown for this query.
        setSettled((previous) =>
          !outcome.ok && previous?.query === inputs.query && previous.outcome.ok
            ? { ...previous, failed: outcome.error }
            : { query: inputs.query, outcome, failed: null },
        );
      } while (takeQueued());
      inFlight.current = false;
    })();
  }, []);

  useEffect(() => {
    // `latest` already holds this render's inputs (its effect runs first).
    if (focused && userId !== null) run();
  }, [focused, userId, query, attempt, run]);

  const current = settled?.query === query ? settled : null;
  const outcome = current?.outcome ?? null;
  // Only this session's good answers are written, and they're shown from `settled`, so a read per
  // user and language is never stale when it's needed.
  const stored = useMemo(() => (userId === null ? null : readStoredForYou(userId, locale)), [userId, locale]);

  let response: ForYouResponse | null = null;
  let failed: AiError | null = null;
  if (outcome?.ok === true) {
    response = outcome.result;
    failed = current?.failed ?? null;
  } else if (stored !== null) {
    response = stored;
    failed = outcome?.ok === false ? outcome.error : null;
  }

  const reload = useCallback(() => {
    setSettled(null);
    setAttempt((value) => value + 1);
  }, []);

  let state: ForYouState;
  if (response !== null) {
    state = response.kind === 'too_small' ? 'too_small' : 'ready';
  } else if (outcome === null) {
    state = 'loading';
  } else {
    state = 'error';
  }

  return {
    state,
    ideas: response?.kind === 'ok' ? response.ideas : [],
    error: response === null && outcome?.ok === false ? outcome.error : null,
    failed,
    reload,
  };
}
