// Runs a callback when the app returns to the foreground and when the network comes back: the
// moments the closet, the upload queue and the wear queue catch up on what they missed.
import * as Network from 'expo-network';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

/** The latest `callback` runs; the first network report only sets the baseline. */
export function useOnResume(callback: () => void): void {
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  });

  useEffect(() => {
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') latest.current();
    });
    let wasOnline: boolean | null = null;
    const network = Network.addNetworkStateListener((event) => {
      const online = event.isConnected === true && event.isInternetReachable !== false;
      if (online && wasOnline === false) latest.current();
      wasOnline = online;
    });
    return () => {
      appState.remove();
      network.remove();
    };
  }, []);
}
