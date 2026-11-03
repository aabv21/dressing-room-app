import { useCallback, useEffect, useState } from 'react';
import { useFrameCallback, useSharedValue, type FrameInfo } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { summarizeFrameDeltas, type FrameStats } from './frameStats';

const MAX_BUFFERED_FRAMES = 6000;
const PUBLISH_INTERVAL_MS = 500;

const EMPTY_STATS: FrameStats = { frames: 0, dropped: 0, droppedRatio: 0, p95Ms: 0 };

/**
 * Tracks per-frame deltas on the UI thread while `active`, publishing summarized drop-rate and
 * p95 stats back to JS every 500 ms. The buffer is capped at 6,000 entries (~50 s at 120 Hz) so a
 * long scroll session can't grow it unbounded.
 *
 * NOTE: shared values are read/written via `.get()`/`.set()`, not `.value` — the React Compiler
 * integration in eslint-plugin-react-hooks v7 doesn't know `useSharedValue`'s `.value` is an
 * intentionally mutable escape hatch and flags direct assignment as an immutability violation.
 * `.get()`/`.set()` are Reanimated's compiler-compliant alternative API for the same shared value.
 */
export function useFrameStats(active: boolean): { stats: FrameStats; reset: () => void } {
  const [stats, setStats] = useState<FrameStats>(EMPTY_STATS);
  const buffer = useSharedValue<number[]>([]);
  const lastPublishedAt = useSharedValue(0);

  const publish = useCallback((deltas: number[]) => {
    setStats(summarizeFrameDeltas(deltas));
  }, []);

  // `useFrameCallback` re-registers its worklet on the UI thread whenever this callback's
  // identity changes (it re-runs its own internal `useEffect` on `[callback, autostart]`). An
  // inline arrow function here would be a fresh closure every render, so while stats are
  // publishing (~every 500ms) the frame callback would unregister/register on the UI thread in
  // lockstep. `buffer` and `lastPublishedAt` are `useSharedValue`'s stable ref-backed objects and
  // `publish` is itself `useCallback`-stable, so this callback's identity only changes if those
  // identities ever would — in practice, never across this hook's lifetime.
  const onFrame = useCallback(
    (frameInfo: FrameInfo) => {
      'worklet';
      const delta = frameInfo.timeSincePreviousFrame;
      if (delta !== null) {
        const current = buffer.get();
        buffer.set(current.length >= MAX_BUFFERED_FRAMES ? [...current.slice(1), delta] : [...current, delta]);
      }

      if (frameInfo.timestamp - lastPublishedAt.get() >= PUBLISH_INTERVAL_MS) {
        lastPublishedAt.set(frameInfo.timestamp);
        scheduleOnRN(publish, buffer.get());
      }
    },
    [buffer, lastPublishedAt, publish],
  );

  const frameCallback = useFrameCallback(onFrame, false);

  const { setActive } = frameCallback;
  useEffect(() => {
    setActive(active);
  }, [active, setActive]);

  const reset = useCallback(() => {
    buffer.set([]);
    lastPublishedAt.set(0);
    setStats(EMPTY_STATS);
  }, [buffer, lastPublishedAt]);

  return { stats, reset };
}
