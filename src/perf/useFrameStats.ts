import { useCallback, useEffect, useRef, useState } from 'react';
import { useFrameCallback, useSharedValue, type FrameInfo } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { appendFrameDeltas, EMPTY_FRAME_STATS, summarizeFrameDeltas, type FrameStats } from './frameStats';

const PUBLISH_INTERVAL_MS = 500;

/**
 * Records per-frame deltas on the UI thread while `active` and summarizes them on the JS thread.
 *
 * The UI thread only appends to a small chunk in place and, every 500 ms, hands that chunk (not
 * the whole history) to JS and starts a new one, so the work it adds to each frame stays constant.
 * JS accumulates the chunks, applies the 6,000-frame cap and recomputes the stats. When `active`
 * turns false, the last partial chunk is flushed too, so the slowdown at the end of a fling is
 * counted.
 *
 * NOTE: shared values are read/written via `.get()`/`.set()`/`.modify()`, not `.value` — the React
 * Compiler integration in eslint-plugin-react-hooks v7 flags direct `.value` assignment as an
 * immutability violation; these are Reanimated's compiler-compliant equivalents.
 */
export function useFrameStats(active: boolean): { stats: FrameStats; reset: () => void } {
  const [stats, setStats] = useState<FrameStats>(EMPTY_FRAME_STATS);
  const chunk = useSharedValue<number[]>([]);
  const lastFlushedAt = useSharedValue(0);
  const deltas = useRef<number[]>([]);

  const receive = useCallback((received: number[]) => {
    deltas.current = appendFrameDeltas(deltas.current, received);
    setStats(summarizeFrameDeltas(deltas.current));
  }, []);

  const flush = useCallback(() => {
    'worklet';
    const pending = chunk.get();
    if (pending.length === 0) {
      return;
    }
    chunk.set([]);
    scheduleOnRN(receive, pending);
  }, [chunk, receive]);

  // `useFrameCallback` re-registers its worklet whenever this callback's identity changes, so it
  // only depends on stable values (shared values and `useCallback`s with stable deps).
  const onFrame = useCallback(
    (frameInfo: FrameInfo) => {
      'worklet';
      const delta = frameInfo.timeSincePreviousFrame;
      if (delta !== null) {
        chunk.modify((pending) => {
          'worklet';
          pending.push(delta);
          return pending;
        });
      }

      if (frameInfo.timestamp - lastFlushedAt.get() >= PUBLISH_INTERVAL_MS) {
        lastFlushedAt.set(frameInfo.timestamp);
        flush();
      }
    },
    [chunk, lastFlushedAt, flush],
  );

  const { setActive } = useFrameCallback(onFrame, false);

  useEffect(() => {
    setActive(active);
    if (!active) {
      // Queued after the deactivation above, so it runs once the last frame has been appended.
      scheduleOnUI(flush);
    }
  }, [active, setActive, flush]);

  const reset = useCallback(() => {
    scheduleOnUI(() => {
      'worklet';
      chunk.set([]);
      lastFlushedAt.set(0);
    });
    deltas.current = [];
    setStats(EMPTY_FRAME_STATS);
  }, [chunk, lastFlushedAt]);

  return { stats, reset };
}
