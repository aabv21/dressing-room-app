// A function answer kept on the device: single-flight fetches for the latest query, shown over the
// stored copy until this session has a good answer of its own. Used by Today's list and For you.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AiError, AiOutcome } from './aiClient';

export type StoredQueryOptions<T> = {
  /** The query's identity: an answer is shown only for the key it was fetched for. */
  key: string;
  /** Fetches on mount, on a new key and after `reload` while true; a queued trigger needs it too. */
  enabled: boolean;
  /** One request for the current inputs. The latest render's is used, so a queued run gets them. */
  fetch: () => Promise<AiOutcome<T>>;
  /** The stored answer for the current inputs; pass a stable callback, it's re-read when it changes. */
  readStored: () => T | null;
  /** Keeps a good answer, with the inputs of the request that got it. */
  store: (result: T) => void;
};

export type StoredQueryStatus = 'loading' | 'ready' | 'offline' | 'error';

export type StoredQuery<T> = {
  /** This session's latest good answer for the key, else the stored one. */
  data: T | null;
  /** `offline` is `data` shown because the latest fetch couldn't connect. */
  status: StoredQueryStatus;
  /** The latest fetch's error for the key: why there's nothing (no `data`), or why `data` is older. */
  error: AiError | null;
  /** Drops the answer and fetches again. */
  reload: () => void;
  /** Fetches again, keeping what's shown. */
  refetch: () => void;
  /** The latest settled answer when it was good, whatever its key. */
  lastData: T | null;
};

type Settled<T> = { key: string; outcome: AiOutcome<T>; failed: AiError | null };

/**
 * At most one request is in flight: a trigger during one runs once after it, with the latest
 * inputs (the outfit functions spend a quota per cache miss, and cache only once a call finishes).
 */
export function useStoredQuery<T>({ key, enabled, fetch, readStored, store }: StoredQueryOptions<T>): StoredQuery<T> {
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  // Bumped by `reload`: the effect below fetches again.
  const [attempt, setAttempt] = useState(0);

  // Declared before the fetch effect, so it's up to date when that runs in the same commit.
  const latest = useRef({ key, enabled, fetch, store });
  useEffect(() => {
    latest.current = { key, enabled, fetch, store };
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

  const refetch = useCallback(() => {
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
      try {
        do {
          const request = latest.current;
          const outcome = await request.fetch();
          if (!mounted.current) return;
          if (outcome.ok) request.store(outcome.result);
          // A failed refetch keeps the answer already shown for this key.
          setSettled((previous) =>
            !outcome.ok && previous?.key === request.key && previous.outcome.ok
              ? { ...previous, failed: outcome.error }
              : { key: request.key, outcome, failed: null },
          );
          // Off screen a trigger waits: coming back fetches anyway.
        } while (takeQueued() && latest.current.enabled);
      } finally {
        inFlight.current = false;
      }
    })();
  }, []);

  useEffect(() => {
    if (enabled) refetch();
  }, [enabled, key, attempt, refetch]);

  const reload = useCallback(() => {
    setSettled(null);
    setAttempt((value) => value + 1);
  }, []);

  const stored = useMemo(() => readStored(), [readStored]);
  const outcome = settled?.key === key ? settled.outcome : null;

  let data: T | null = null;
  let error: AiError | null = outcome?.ok === false ? outcome.error : null;
  if (outcome?.ok === true) {
    data = outcome.result;
    error = settled?.failed ?? null;
  } else if (stored !== null) {
    data = stored;
  }

  let status: StoredQueryStatus;
  if (data !== null) status = error === 'network' ? 'offline' : 'ready';
  else status = outcome === null ? 'loading' : 'error';

  return { data, status, error, reload, refetch, lastData: settled?.outcome.ok === true ? settled.outcome.result : null };
}
