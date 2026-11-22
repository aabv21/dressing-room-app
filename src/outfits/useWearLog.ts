// "I'll wear it" for Today and the rating: one wear at a time, logged or queued, then marked worn today,
// with an undo for a few seconds after.
import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import type { Occasion } from '../closet/catalog';
import { useCloset } from '../closet/ClosetProvider';
import { useI18n } from '../i18n';
import type { RequestError } from '../lib/requestResult';
import { deleteWear } from '../stats/wearsRepository';
import { announceForAccessibility } from '../ui/a11y';
import { logWear } from './outfitRepository';
import { dequeueWear, logWearOrQueue, queuedWears } from './wearQueue';
import { outfitIdentity, unmarkWornToday, useWornToday } from './wornToday';

/** How long "Undo" stays offered after a wear; longer with a screen reader, which takes time to reach it. */
export const UNDO_WINDOW_MS = 5000;
export const SCREEN_READER_UNDO_WINDOW_MS = 15000;

/** Whether a screen reader is on, kept current while mounted; false until the first answer. */
function useScreenReader(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let current = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((value) => {
      if (current) setEnabled(value);
    });
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', setEnabled);
    return () => {
      current = false;
      subscription.remove();
    };
  }, []);
  return enabled;
}

/** `ignored`: a wear was already sending, so this tap did nothing. */
export type WearLogStatus = 'logged' | 'queued' | 'failed' | 'ignored';
/** `ignored`: nothing to undo for that outfit (the window closed), or a wear or undo was running. */
export type UndoStatus = 'undone' | 'failed' | 'ignored';

export type WearLog = {
  log: (garmentIds: readonly string[], occasion: Occasion | null, score?: number | null) => Promise<WearLogStatus>;
  busy: boolean;
  isLogged: (garmentIds: readonly string[]) => boolean;
  /** The last failed wear's error, while it's for this outfit. */
  errorFor: (garmentIds: readonly string[]) => RequestError | null;
  clearError: () => void;
  /** Whether this outfit's wear still waits in the offline queue. */
  isQueued: (garmentIds: readonly string[]) => boolean;
  /** Whether "Undo" is offered: for `UNDO_WINDOW_MS` after this outfit's wear was logged or queued. */
  canUndo: (garmentIds: readonly string[]) => boolean;
  undo: (garmentIds: readonly string[]) => Promise<UndoStatus>;
  /** The last undo of this outfit failed; Undo is offered again while its window lasts. */
  undoFailedFor: (garmentIds: readonly string[]) => boolean;
};

/** Logs wears on `day`. Each outfit keeps one wear id until it succeeds, so a lost answer can't log it twice. */
export function useWearLog(day: string): WearLog {
  const { t } = useI18n();
  const { userId } = useAuth();
  const { refresh } = useCloset();
  const { isWorn, markWorn } = useWornToday(day);
  const keyOf = useCallback((garmentIds: readonly string[]) => `${day}|${outfitIdentity(garmentIds)}`, [day]);

  // The ref locks a second tap before the re-render lands.
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ key: string; error: RequestError } | null>(null);
  const [queued, setQueued] = useState<{ key: string; wearId: string } | null>(null);
  const [undoable, setUndoable] = useState<{ key: string; wearId: string } | null>(null);
  const [undoFailed, setUndoFailed] = useState<string | null>(null);
  const screenReader = useScreenReader();
  const undoWindow = screenReader ? SCREEN_READER_UNDO_WINDOW_MS : UNDO_WINDOW_MS;
  const wearIds = useRef(new Map<string, string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (undoable === null) return undefined;
    const timer = setTimeout(() => {
      setUndoable(null);
    }, undoWindow);
    return () => {
      clearTimeout(timer);
    };
  }, [undoable, undoWindow]);

  const log = useCallback(
    async (garmentIds: readonly string[], occasion: Occasion | null, score: number | null = null): Promise<WearLogStatus> => {
      if (sending.current) return 'ignored';
      sending.current = true;
      setBusy(true);
      setError(null);
      setUndoFailed(null);
      const key = keyOf(garmentIds);
      let wearId = wearIds.current.get(key);
      if (wearId === undefined) {
        wearId = randomUUID();
        wearIds.current.set(key, wearId);
      }
      const input = { wearId, garmentIds: [...garmentIds], wornOn: day, occasion, score };
      // Offline the wear waits in the queue (WearQueueFlusher sends it) and shows as logged now.
      const outcome =
        userId === null ? { status: 'failed' as const, error: 'unknown' as const } : await logWearOrQueue(userId, input, logWear);
      sending.current = false;
      if (outcome.status !== 'failed') {
        wearIds.current.delete(key);
        markWorn(garmentIds);
        if (outcome.status === 'logged') void refresh();
      }
      if (!mounted.current) return outcome.status;
      setBusy(false);
      if (outcome.status !== 'failed') setUndoable({ key, wearId });
      if (outcome.status === 'failed') {
        setError({ key, error: outcome.error });
        announceForAccessibility(t(`outfit.error.${outcome.error}`));
      } else if (outcome.status === 'queued') {
        setQueued({ key, wearId });
        announceForAccessibility(t('outfit.queued'));
      } else {
        announceForAccessibility(t('outfit.logged.undoAvailable'));
      }
      return outcome.status;
    },
    [day, keyOf, markWorn, refresh, t, userId],
  );

  const errorFor = useCallback(
    (garmentIds: readonly string[]) => (error !== null && error.key === keyOf(garmentIds) ? error.error : null),
    [error, keyOf],
  );
  const clearError = useCallback(() => {
    setError(null);
    setUndoFailed(null);
  }, []);
  // Read on every call: the flusher's closet refresh re-renders the screen once the wear is sent.
  const isQueued = useCallback(
    (garmentIds: readonly string[]) =>
      queued !== null &&
      queued.key === keyOf(garmentIds) &&
      userId !== null &&
      queuedWears(userId).some((wear) => wear.wearId === queued.wearId),
    [queued, keyOf, userId],
  );

  const canUndo = useCallback(
    (garmentIds: readonly string[]) => undoable !== null && undoable.key === keyOf(garmentIds),
    [undoable, keyOf],
  );

  const undo = useCallback(
    async (garmentIds: readonly string[]): Promise<UndoStatus> => {
      const key = keyOf(garmentIds);
      if (sending.current || userId === null || undoable === null || undoable.key !== key) return 'ignored';
      const target = undoable;
      sending.current = true;
      setBusy(true);
      setError(null);
      setUndoFailed(null);
      setUndoable(null);
      // A queued wear never reached the server. Otherwise it's deleted there; one a flush is still sending
      // isn't there yet, so the delete finds no row and fails, and Undo comes back for a retry.
      const result = dequeueWear(userId, target.wearId) ? { ok: true as const } : await deleteWear(target.wearId);
      sending.current = false;
      if (result.ok) {
        unmarkWornToday(userId, garmentIds);
        void refresh();
      }
      if (!mounted.current) return result.ok ? 'undone' : 'failed';
      setBusy(false);
      if (!result.ok) {
        // A fresh object restarts the window, so the retry isn't cut short.
        setUndoable({ ...target });
        setUndoFailed(key);
        announceForAccessibility(t('outfit.undoFailed'));
        return 'failed';
      }
      setQueued(null);
      announceForAccessibility(t('outfit.undone'));
      return 'undone';
    },
    [keyOf, refresh, t, undoable, userId],
  );

  const undoFailedFor = useCallback((garmentIds: readonly string[]) => undoFailed === keyOf(garmentIds), [undoFailed, keyOf]);

  return { log, busy, isLogged: isWorn, errorFor, clearError, isQueued, canUndo, undo, undoFailedFor };
}
