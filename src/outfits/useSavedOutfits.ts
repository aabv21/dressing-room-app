// The Saved segment's list, served from the stored copy when the fetch fails.
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { listSavedOutfits, type SavedOutfit } from './savedOutfits';
import { readStoredSaved, storeSaved } from './storedSaved';

export type SavedOutfits = {
  /** Null until the first answer (or the stored copy). */
  saved: SavedOutfit[] | null;
  /** The list shown is the stored one because the fetch failed. */
  offline: boolean;
  /** The fetch failed and nothing is stored. */
  failed: boolean;
  reload: () => void;
  /** Drops a deleted outfit from the list and the stored copy. */
  removeLocal: (id: string) => void;
};

/** Fetches whenever `enabled` turns true (the segment's focus) and after `reload`. */
export function useSavedOutfits(enabled: boolean): SavedOutfits {
  const { userId } = useAuth();
  const [saved, setSaved] = useState<SavedOutfit[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    let current = true;
    listSavedOutfits().then(
      (list) => {
        if (userId !== null) storeSaved(userId, list);
        if (!current) return;
        setSaved(list);
        setOffline(false);
        setFailed(false);
      },
      () => {
        if (!current) return;
        const stored = userId === null ? null : readStoredSaved(userId);
        setSaved((shown) => stored ?? shown);
        setOffline(stored !== null);
        setFailed(stored === null);
      },
    );
    return () => {
      current = false;
    };
  }, [enabled, userId, attempt]);

  const reload = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  const removeLocal = useCallback(
    (id: string) => {
      setSaved((shown) => {
        if (shown === null) return shown;
        const next = shown.filter((outfit) => outfit.id !== id);
        if (userId !== null) storeSaved(userId, next);
        return next;
      });
    },
    [userId],
  );

  return { saved, offline, failed, reload, removeLocal };
}
