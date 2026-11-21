// Sends the "I'll wear it"s queued offline (`wearQueue.ts`) on mount, on returning to the
// foreground and when the network comes back, the same triggers `ClosetProvider` refreshes on;
// once any was sent, the closet refreshes so the wear counts move. Renders nothing.
import { useCallback, useEffect } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { storedSessionUserId } from '../auth/authService';
import { useCloset } from '../closet/ClosetProvider';
import { useOnResume } from '../lib/useOnResume';
import { logWear } from './outfitRepository';
import { flushWearQueue } from './wearQueue';

export function WearQueueFlusher(): null {
  const { userId } = useAuth();
  const { refresh } = useCloset();

  const flush = useCallback(() => {
    if (userId === null) return;
    void flushWearQueue(userId, { send: logWear, sessionUserId: storedSessionUserId }).then(({ sent }) => {
      if (sent > 0) void refresh();
    });
  }, [userId, refresh]);
  useEffect(flush, [flush]);
  useOnResume(flush);

  return null;
}
