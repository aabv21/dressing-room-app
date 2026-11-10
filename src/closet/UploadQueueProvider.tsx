import * as Network from 'expo-network';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, AppState } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { useI18n } from '../i18n';
import { useCloset } from './ClosetProvider';
import {
  enqueuePhotos,
  enqueueReplacement as storeReplacement,
  listQueue,
  removeItem,
  resetFailed,
  type QueueItem,
} from './upload/queueStore';
import { createQueueSteps } from './upload/queueSteps';
import { runQueue } from './upload/runQueue';

interface UploadQueueContextValue {
  /** Photos still on their way (including ones waiting out a retry backoff). */
  pending: number;
  /** Photos that gave up (a permanent error, or 8 attempts) until retried or discarded. */
  failed: number;
  enqueue: (uris: readonly string[]) => void;
  enqueueReplacement: (garmentId: string, uri: string) => void;
  retryFailed: () => void;
  discardFailed: () => void;
}

type Counts = { pending: number; failed: number };

const UploadQueueContext = createContext<UploadQueueContextValue | undefined>(undefined);

function countsOf(items: readonly QueueItem[]): Counts {
  let failed = 0;
  for (const item of items) {
    if (item.failed) {
      failed += 1;
    }
  }
  return { pending: items.length - failed, failed };
}

/** The earliest future retry among items still trying, or null when nothing is waiting. */
function nextRetryAt(items: readonly QueueItem[], now: number): number | null {
  let next: number | null = null;
  for (const item of items) {
    if (!item.failed && item.nextAttemptAt > now && (next === null || item.nextAttemptAt < next)) {
      next = item.nextAttemptAt;
    }
  }
  return next;
}

/**
 * Runs the signed-in user's persisted upload queue: on mount (a launch resumes whatever an earlier
 * session left), after every enqueue, when the app returns to the foreground, when the network
 * comes back, and (P3-R9) at the earliest pending retry, so a backed-off item doesn't wait for an
 * unrelated trigger while the app stays open. A pass that committed garments refreshes the closet.
 */
export function UploadQueueProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { userId: sessionUserId } = useAuth();
  // The user whose queue this is, fixed for the provider's lifetime (keyed by user in the layout);
  // a pass started for them never runs another account's queue during a switch.
  const [userId] = useState(sessionUserId);
  const sessionUser = useRef(sessionUserId);
  useEffect(() => {
    sessionUser.current = sessionUserId;
  }, [sessionUserId]);
  const { refresh } = useCloset();
  const { t } = useI18n();
  const steps = useMemo(() => createQueueSteps(), []);
  const [counts, setCounts] = useState<Counts>(() =>
    userId === null ? { pending: 0, failed: 0 } : countsOf(listQueue(userId)),
  );
  // A new object after every pass (even for the same time), so the timer effect below always
  // re-arms: a pass that ended without changing the earliest retry still schedules one.
  const [nextRetry, setNextRetry] = useState<{ at: number } | null>(null);
  const mounted = useRef(true);

  const syncCounts = useCallback((): readonly QueueItem[] => {
    const items = userId === null ? [] : listQueue(userId);
    if (mounted.current) {
      setCounts(countsOf(items));
    }
    return items;
  }, [userId]);

  const run = useCallback(async (): Promise<void> => {
    // Another account's session is already active (a switch still settling): starting a pass would
    // only burn the owner's retry attempts on SessionMismatchError.
    if (userId === null || sessionUser.current !== userId) {
      return;
    }
    let committed = 0;
    try {
      ({ committed } = await runQueue(userId, steps));
    } catch {
      // A storage error aborted the pass; the items stay queued for the next trigger.
    }
    // Unmounted (signed out or switched user) while the pass ran: no refresh and no retry timer
    // for a user who is gone. Their items stay queued for their next sign-in.
    if (!mounted.current) {
      return;
    }
    const items = syncCounts();
    if (committed > 0) {
      void refresh();
    }
    const at = nextRetryAt(items, Date.now());
    setNextRetry(at === null ? null : { at });
  }, [userId, steps, syncCounts, refresh]);

  useEffect(() => {
    if (nextRetry === null) {
      return undefined;
    }
    const timer = setTimeout(() => {
      void run();
    }, Math.max(0, nextRetry.at - Date.now()));
    return () => {
      clearTimeout(timer);
    };
  }, [nextRetry, run]);

  useEffect(() => {
    mounted.current = true;
    void run();

    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void run();
      }
    });
    let wasOnline: boolean | null = null;
    const network = Network.addNetworkStateListener((event) => {
      const online = event.isConnected === true && event.isInternetReachable !== false;
      if (online && wasOnline === false) {
        void run();
      }
      wasOnline = online;
    });

    return () => {
      mounted.current = false;
      appState.remove();
      network.remove();
    };
  }, [run]);

  const enqueue = useCallback(
    (uris: readonly string[]) => {
      if (userId === null || uris.length === 0) {
        return;
      }
      try {
        enqueuePhotos(userId, uris);
      } catch {
        // Copying a picked photo into the app's storage failed (e.g. the disk is full). The
        // photos copied before it are queued and still run below.
        Alert.alert(t('closet.addFailed'));
      }
      syncCounts();
      void run();
    },
    [userId, syncCounts, run, t],
  );

  const enqueueReplacement = useCallback(
    (garmentId: string, uri: string) => {
      if (userId === null) {
        return;
      }
      try {
        storeReplacement(userId, garmentId, uri);
      } catch {
        Alert.alert(t('closet.addFailed'));
      }
      syncCounts();
      void run();
    },
    [userId, syncCounts, run, t],
  );

  const retryFailed = useCallback(() => {
    if (userId === null) {
      return;
    }
    resetFailed(userId);
    syncCounts();
    void run();
  }, [userId, syncCounts, run]);

  const discardFailed = useCallback(() => {
    if (userId === null) {
      return;
    }
    for (const item of listQueue(userId)) {
      if (item.failed) {
        removeItem(item);
      }
    }
    syncCounts();
  }, [userId, syncCounts]);

  const value = useMemo<UploadQueueContextValue>(
    () => ({ ...counts, enqueue, enqueueReplacement, retryFailed, discardFailed }),
    [counts, enqueue, enqueueReplacement, retryFailed, discardFailed],
  );

  return <UploadQueueContext.Provider value={value}>{children}</UploadQueueContext.Provider>;
}

export function useUploadQueue(): UploadQueueContextValue {
  const value = useContext(UploadQueueContext);
  if (value === undefined) {
    throw new Error('useUploadQueue must be used inside an UploadQueueProvider');
  }
  return value;
}
