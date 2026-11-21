// The wears of a day range for Stats and Diary: fetched while enabled, kept on the device, and
// served from the stored copy when the fetch fails, so both stay readable offline.
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { localDate } from '../outfits/aiClient';
import { withQueuedWears } from '../outfits/wearQueue';
import { mergeStoredWears, readStoredWears, storeWears, wearsInRange } from './storedWears';
import { listWears, type WearWithItems } from './wearsRepository';

export type WearsOptions = {
  /** Fetches on enable, on a new range and after `reload`; Stats and Diary pass their focus. */
  enabled: boolean;
  /**
   * `replace`: the range is the whole stored record (Stats' year), shown whole when offline.
   * `merge`: the range is folded into it up to today (Diary's month), and shown offline only when
   * the record covers the range's start.
   */
  record: 'replace' | 'merge';
};

export type Wears = {
  /** The range's wears plus the queued ones not sent yet; null until the first answer. */
  wears: WearWithItems[] | null;
  /** The stored record's last day when it's shown because the fetch failed; null when fresh. */
  offlineSince: string | null;
  /** The fetch failed and nothing stored covers the range. */
  failed: boolean;
  /** The local day of the latest answer, which the periods count from. */
  today: string;
  reload: () => void;
  /** Drops a deleted wear from the shown list until the next answer. */
  removeLocal: (wearId: string) => void;
};

type Loaded = { key: string; wears: WearWithItems[]; offlineSince: string | null };

export function useWears(from: string, to: string, { enabled, record }: WearsOptions): Wears {
  const { userId } = useAuth();
  const [today, setToday] = useState(() => localDate());
  // Keyed by range, so a new range never shows the previous one's wears.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${from}|${to}`;

  useEffect(() => {
    if (!enabled) return undefined;
    let current = true;
    listWears(from, to).then(
      (wears) => {
        const day = localDate();
        if (userId !== null) {
          // Stored only up to today: the rest of a month hasn't happened yet.
          if (record === 'replace') storeWears(userId, from, to, wears);
          else mergeStoredWears(userId, from, to < day ? to : day, wears);
        }
        if (!current) return;
        setToday(day);
        // Wears queued offline count too, until they're sent (stored without them).
        setLoaded({ key, wears: userId === null ? wears : withQueuedWears(userId, wears, from, to), offlineSince: null });
        setFailedKey(null);
      },
      () => {
        if (!current) return;
        const stored = userId === null ? null : readStoredWears(userId);
        const wears = stored === null ? null : record === 'replace' ? stored.wears : wearsInRange(stored, from, to);
        if (userId === null || stored === null || wears === null) {
          setFailedKey(key);
          return;
        }
        setToday(localDate());
        setLoaded({ key, wears: withQueuedWears(userId, wears, from, to), offlineSince: stored.to });
        setFailedKey(null);
      },
    );
    return () => {
      current = false;
    };
  }, [enabled, from, to, key, record, userId, attempt]);

  const reload = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  const removeLocal = useCallback((wearId: string) => {
    setLoaded((previous) => (previous === null ? previous : { ...previous, wears: previous.wears.filter((w) => w.id !== wearId) }));
  }, []);

  const current = loaded?.key === key ? loaded : null;
  return { wears: current?.wears ?? null, offlineSince: current?.offlineSince ?? null, failed: failedKey === key, today, reload, removeLocal };
}
