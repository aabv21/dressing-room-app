// Stats' year of wears: fetched on each focus and stored, and served from the stored copy when the
// fetch fails, so Stats stays readable offline (spec §5.4).
import { useEffect, useState } from 'react';

import { localDate } from '../outfits/aiClient';
import { withQueuedWears } from '../outfits/wearQueue';
import { addDays, STREAK_HISTORY_DAYS } from './periods';
import { readStoredWears, storeWears } from './storedWears';
import { listWears, type WearWithItems } from './wearsRepository';

export type WearHistory = {
  /** Today, the day the periods count from, also when the shown history is the stored one. */
  today: string;
  wears: WearWithItems[] | null;
  /** The stored history's last day when it's shown because the fetch failed; null when fresh. */
  offlineSince: string | null;
  /** The fetch failed and nothing was stored. */
  failed: boolean;
};

export function useWearHistory(userId: string | null, focused: boolean): WearHistory {
  const [history, setHistory] = useState<WearHistory>(() => ({
    today: localDate(),
    wears: null,
    offlineSince: null,
    failed: false,
  }));

  useEffect(() => {
    if (!focused) {
      return undefined;
    }
    let current = true;
    const day = localDate();
    const from = addDays(day, -STREAK_HISTORY_DAYS);
    listWears(from, day).then(
      (wears) => {
        if (userId !== null) storeWears(userId, from, day, wears);
        // Wears queued offline count too, until they're sent (stored without them).
        const shown = userId === null ? wears : withQueuedWears(userId, wears, from, day);
        if (current) setHistory({ today: day, wears: shown, offlineSince: null, failed: false });
      },
      () => {
        if (!current) return;
        const stored = userId === null ? null : readStoredWears(userId);
        if (userId === null || stored === null) {
          setHistory((previous) => ({ ...previous, failed: true }));
          return;
        }
        setHistory({
          today: day,
          wears: withQueuedWears(userId, stored.wears, from, day),
          offlineSince: stored.to,
          failed: false,
        });
      },
    );
    return () => {
      current = false;
    };
  }, [focused, userId]);

  return history;
}
