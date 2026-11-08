import * as Network from 'expo-network';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { kvGet, kvSet } from '../lib/kv';
import { isLivePending } from './closetSelectors';
import { garmentPhotoPath, listGarments, signedPhotoUrls, type Garment } from './garmentRepository';

export type ClosetStatus = 'loading' | 'ready' | 'offline';

interface ClosetContextValue {
  /** The signed-in user's garments, newest first. */
  garments: Garment[];
  /** Signed thumbnail URLs keyed by garment id; a garment without one is absent. */
  thumbUrls: Map<string, string>;
  /** `offline`: the last refresh failed, and `garments` is the last list this device saw. */
  status: ClosetStatus;
  refresh: () => Promise<void>;
  /** Applies a garment the caller just saved (or created) without waiting for a refresh. */
  replaceLocal: (g: Garment) => void;
  removeLocal: (id: string) => void;
}

/**
 * `photoVersion` is the garment's `photo_version` the URL was signed for. A replaced photo keeps its
 * storage path, so only a fresh signature (a new URL) gets past an HTTP or CDN cache of the old one;
 * a thumbnail whose version no longer matches its row is re-signed at once, not after 50 minutes.
 */
type SignedThumb = { url: string; signedAt: number; photoVersion: number };
type CachedCloset = { garments: Garment[]; thumbs: Record<string, SignedThumb> };

const POLL_INTERVAL_MS = 5_000;
// Signed URLs live 3600 s; re-sign well before that so a cell never gets an expired one.
const RESIGN_AFTER_MS = 50 * 60 * 1000;

const ClosetContext = createContext<ClosetContextValue | undefined>(undefined);

function cacheKey(userId: string): string {
  return `closet.v1.${userId}`;
}

function readCache(userId: string): CachedCloset | null {
  const raw = kvGet(cacheKey(userId));
  if (raw === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CachedCloset>;
    return Array.isArray(parsed.garments) ? { garments: parsed.garments, thumbs: parsed.thumbs ?? {} } : null;
  } catch {
    return null;
  }
}

/**
 * The closet's garments and signed thumbnail URLs for the signed-in user, with an on-device copy
 * (kv `closet.v1.<userId>`) so an offline launch still shows the last known closet. The cached
 * signed URLs may have expired by then; the grid's cache keys still find the photos in
 * expo-image's disk cache. Mounted only while signed in, keyed by user id, so a user switch
 * starts from that user's own cache.
 */
export function ClosetProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { userId: sessionUserId } = useAuth();
  // The user this closet belongs to, fixed for the provider's lifetime (the layout keys it by
  // user). During a user switch AuthProvider reports the next user while this tree is still
  // mounted, so `sessionUserId` can differ from it.
  const [userId] = useState(sessionUserId);
  const sessionUser = useRef(sessionUserId);
  useEffect(() => {
    sessionUser.current = sessionUserId;
  }, [sessionUserId]);
  const [initial] = useState(() => (userId === null ? null : readCache(userId)));
  const [garments, setGarments] = useState<Garment[]>(initial?.garments ?? []);
  const [thumbs, setThumbs] = useState<Record<string, SignedThumb>>(initial?.thumbs ?? {});
  const [status, setStatus] = useState<ClosetStatus>('loading');

  // The latest values, for the async refresh and the local edits, which must not race each other
  // through stale closures.
  const latest = useRef<CachedCloset>({ garments, thumbs });
  const inFlight = useRef<Promise<void> | null>(null);
  const followUp = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);

  // Work started for this closet's user must not land after they are gone: after unmount (sign-out)
  // or once another account's session is active, a late result would overwrite this user's
  // offline copy with an empty or foreign list.
  const isCurrent = useCallback(() => mounted.current && sessionUser.current === userId, [userId]);

  const commit = useCallback(
    (next: CachedCloset) => {
      if (!isCurrent()) {
        return;
      }
      latest.current = next;
      if (userId !== null) {
        kvSet(cacheKey(userId), JSON.stringify(next));
      }
      setGarments(next.garments);
      setThumbs(next.thumbs);
    },
    [userId, isCurrent],
  );

  const load = useCallback(async () => {
    try {
      const listed = await listGarments();
      if (!isCurrent()) {
        return;
      }
      const now = Date.now();
      const previous = latest.current.thumbs;
      const current = (g: Garment, known: SignedThumb | undefined): known is SignedThumb =>
        known !== undefined && known.photoVersion === g.photo_version;
      const toSign = listed.filter((g) => {
        const known = previous[g.id];
        return !current(g, known) || now - known.signedAt > RESIGN_AFTER_MS;
      });
      // A thumbnail signed for an older photo is dropped rather than carried over: the grid's cache
      // key already names the new version, and the old URL would cache the old photo under it.
      const nextThumbs: Record<string, SignedThumb> = {};
      for (const g of listed) {
        const known = previous[g.id];
        if (current(g, known)) {
          nextThumbs[g.id] = known;
        }
      }
      // Commit the list before signing, so a signing failure still shows the fresh rows.
      commit({ garments: listed, thumbs: nextThumbs });
      if (toSign.length > 0 && userId !== null) {
        const signed = await signedPhotoUrls(toSign.map((g) => garmentPhotoPath(userId, g.id, 'thumb')));
        if (!isCurrent()) {
          return;
        }
        const freshThumbs: Record<string, SignedThumb> = {};
        for (const g of toSign) {
          const url = signed.get(garmentPhotoPath(userId, g.id, 'thumb'));
          if (url !== undefined) {
            freshThumbs[g.id] = { url, signedAt: now, photoVersion: g.photo_version };
          }
        }
        commit({ garments: latest.current.garments, thumbs: { ...latest.current.thumbs, ...freshThumbs } });
      }
      setStatus('ready');
    } catch {
      if (isCurrent()) {
        setStatus('offline');
      }
    }
  }, [commit, userId, isCurrent]);

  // One refresh at a time. A call that arrives mid-refresh gets one follow-up refresh (shared by
  // every such caller), so a caller that just changed data on the server always sees it.
  const refresh = useCallback((): Promise<void> => {
    const start = (): Promise<void> => {
      if (!isCurrent()) {
        return Promise.resolve();
      }
      const run = load().finally(() => {
        inFlight.current = null;
      });
      inFlight.current = run;
      return run;
    };
    const running = inFlight.current;
    if (running === null) {
      return start();
    }
    followUp.current ??= running.then(() => {
      followUp.current = null;
      return inFlight.current ?? start();
    });
    return followUp.current;
  }, [load, isCurrent]);

  // Refresh on mount, on returning to the foreground (signed URLs may have expired meanwhile; only
  // stale ones are re-signed) and when the network comes back (clears `offline`).
  useEffect(() => {
    mounted.current = true;
    void refresh();

    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refresh();
      }
    });
    let wasOnline: boolean | null = null;
    const network = Network.addNetworkStateListener((event) => {
      const online = event.isConnected === true && event.isInternetReachable !== false;
      if (online && wasOnline === false) {
        void refresh();
      }
      wasOnline = online;
    });

    return () => {
      mounted.current = false;
      appState.remove();
      network.remove();
    };
  }, [refresh]);

  const replaceLocal = useCallback(
    (g: Garment) => {
      const current = latest.current;
      const exists = current.garments.some((entry) => entry.id === g.id);
      const nextGarments = exists
        ? current.garments.map((entry) => (entry.id === g.id ? g : entry))
        : [g, ...current.garments];
      commit({ garments: nextGarments, thumbs: current.thumbs });
    },
    [commit],
  );

  const removeLocal = useCallback(
    (id: string) => {
      const current = latest.current;
      const nextThumbs = Object.fromEntries(Object.entries(current.thumbs).filter(([key]) => key !== id));
      commit({ garments: current.garments.filter((entry) => entry.id !== id), thumbs: nextThumbs });
    },
    [commit],
  );

  const thumbUrls = useMemo(
    () => new Map(Object.entries(thumbs).map(([id, entry]) => [id, entry.url])),
    [thumbs],
  );

  const value = useMemo<ClosetContextValue>(
    () => ({ garments, thumbUrls, status, refresh, replaceLocal, removeLocal }),
    [garments, thumbUrls, status, refresh, replaceLocal, removeLocal],
  );

  return <ClosetContext.Provider value={value}>{children}</ClosetContext.Provider>;
}

export function useCloset(): ClosetContextValue {
  const value = useContext(ClosetContext);
  if (value === undefined) {
    throw new Error('useCloset must be used inside a ClosetProvider');
  }
  return value;
}

/**
 * While `active` (the Closet or Review screen is focused), refreshes every 5 s as long as some
 * garment is still waiting for its extraction. A garment pending for over 10 minutes no longer
 * counts: it is treated as failed and goes to review.
 */
export function usePendingPolling(active: boolean): void {
  const { garments, refresh } = useCloset();

  useEffect(() => {
    const waiting = (): boolean => {
      const now = Date.now();
      return garments.some((g) => isLivePending(g, now));
    };
    if (!active || !waiting()) {
      return undefined;
    }
    const timer = setInterval(() => {
      if (waiting()) {
        void refresh();
      } else {
        clearInterval(timer);
      }
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [active, garments, refresh]);
}
