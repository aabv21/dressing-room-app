// Sends the "I'll wear it"s queued offline (`wearQueue.ts`) on mount, on returning to the
// foreground and when the network comes back, the same triggers `ClosetProvider` refreshes on;
// once any was sent, the closet refreshes so the wear counts move. Renders nothing.
import * as Network from 'expo-network';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { storedSessionUserId } from '../auth/authService';
import { useCloset } from '../closet/ClosetProvider';
import { logWear } from './outfitRepository';
import { flushWearQueue } from './wearQueue';

export function WearQueueFlusher(): null {
  const { userId } = useAuth();
  const { refresh } = useCloset();

  useEffect(() => {
    if (userId === null) return undefined;
    const flush = (): void => {
      void flushWearQueue(userId, { send: logWear, sessionUserId: storedSessionUserId }).then(({ sent }) => {
        if (sent > 0) void refresh();
      });
    };
    flush();

    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') flush();
    });
    let wasOnline: boolean | null = null;
    const network = Network.addNetworkStateListener((event) => {
      const online = event.isConnected === true && event.isInternetReachable !== false;
      if (online && wasOnline === false) flush();
      wasOnline = online;
    });
    return () => {
      appState.remove();
      network.remove();
    };
  }, [userId, refresh]);

  return null;
}
