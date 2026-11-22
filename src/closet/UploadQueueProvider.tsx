import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert } from 'react-native';

import { confirmPendingDeletion } from '../account/deletionFlow';
import { deletionState } from '../account/deletionMarker';
import { useAuth } from '../auth/AuthProvider';
import { useI18n } from '../i18n';
import { useOnResume } from '../lib/useOnResume';
import { useCloset } from './ClosetProvider';
import {
  clearQueue,
  enqueuePhotos,
  enqueueReplacement as storeReplacement,
  listQueue,
  removeItem,
  resetFailed,
  type QueueItem,
} from './upload/queueStore';
import { dropQueuePurgeRequest, queuePurgeRequests } from './upload/queuePurge';
import { createQueueSteps } from './upload/queueSteps';
import { pauseQueue, resumeQueue, runQueue } from './upload/runQueue';

interface UploadQueueContextValue {
  /** Photos still on their way (including ones waiting out a retry backoff). */
  pending: number;
  /** Photos that gave up (a permanent error, or 8 attempts) until retried or discarded. */
  failed: number;
  /** Answers how many were queued: fewer than given when a copy failed (already alerted). */
  enqueue: (uris: readonly string[]) => number;
  enqueueReplacement: (garmentId: string, uri: string) => void;
  retryFailed: () => void;
  discardFailed: () => void;
  /**
   * For account deletion: `pause` resolves once a stage in flight has finished, so nothing reaches
   * storage after the server's listing; `clear` only once the account is gone; `resume` runs the queue
   * (`run: false` only unpauses, for a user signing out).
   */
  pause: () => Promise<void>;
  clear: () => void;
  resume: (options?: { run?: boolean }) => void;
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

/** When the queue runs and how an unconfirmed deletion holds it: docs/app.md#the-closet-srccloset. */
export function UploadQueueProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { userId: sessionUserId } = useAuth();
  // Fixed for the provider's lifetime (keyed by user in the layout), so a switch never runs another queue.
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
  // A new object after every pass, even for the same time, so the timer effect always re-arms.
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
    // Another account's session is active (a switch settling): a pass would only burn retry attempts.
    if (userId === null || sessionUser.current !== userId) {
      return;
    }
    // A deletion this device started for the user isn't confirmed: nothing may reach storage.
    if (deletionState(userId) !== null) {
      return;
    }
    let committed = 0;
    try {
      ({ committed } = await runQueue(userId, steps));
    } catch {
      // A storage error aborted the pass; the items stay queued for the next trigger.
    }
    // Unmounted while the pass ran: no refresh or timer for a user who is gone; their items stay queued.
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

  const pause = useCallback(async () => {
    if (userId === null) {
      return;
    }
    await pauseQueue(userId);
  }, [userId]);

  const clear = useCallback(() => {
    if (userId === null) {
      return;
    }
    clearQueue(userId);
    syncCounts();
  }, [userId, syncCounts]);

  const resume = useCallback(
    (options?: { run?: boolean }) => {
      if (userId === null) {
        return;
      }
      resumeQueue(userId);
      if (options?.run !== false) {
        void run();
      }
    },
    [userId, run],
  );

  /** While a deletion is unconfirmed, only verifies the account (never deletes) and returns true to skip the run. */
  const verifyPendingDeletion = useCallback((): boolean => {
    if (userId === null || deletionState(userId) === null) {
      return false;
    }
    void confirmPendingDeletion(userId, { pause, clear, resume });
    return true;
  }, [userId, pause, clear, resume]);

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

  // Carries out `queue.purge.<uid>` requests (only dropped for this user): docs/app.md#account-deletion-on-the-device.
  useEffect(() => {
    let requests: string[];
    try {
      requests = queuePurgeRequests();
    } catch {
      return; // The kv store couldn't be read: retried at the next mount.
    }
    for (const requested of requests) {
      try {
        if (requested !== userId) {
          clearQueue(requested);
        }
        dropQueuePurgeRequest(requested);
      } catch {
        // Retried at the next mount.
      }
    }
  }, [userId]);

  // Mount, foreground and reconnect either check an unconfirmed deletion or run the queue.
  const trigger = useCallback(() => {
    if (!verifyPendingDeletion()) {
      void run();
    }
  }, [run, verifyPendingDeletion]);
  useEffect(() => {
    mounted.current = true;
    trigger();
    return () => {
      mounted.current = false;
    };
  }, [trigger]);
  useOnResume(trigger);

  const enqueue = useCallback(
    (uris: readonly string[]) => {
      if (userId === null || uris.length === 0) {
        return 0;
      }
      // A photo that couldn't be copied (e.g. a full disk) is reported; the others still run.
      const { items, failed } = enqueuePhotos(userId, uris);
      if (failed > 0) {
        Alert.alert(t('closet.addFailed'));
      }
      syncCounts();
      void run();
      return items.length;
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
    () => ({ ...counts, enqueue, enqueueReplacement, retryFailed, discardFailed, pause, clear, resume }),
    [counts, enqueue, enqueueReplacement, retryFailed, discardFailed, pause, clear, resume],
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
