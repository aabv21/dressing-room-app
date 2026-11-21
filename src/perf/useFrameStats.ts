import { useCallback, useEffect, useRef, useState } from 'react';
import { useFrameCallback, useSharedValue, type FrameInfo } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { appendFrameDeltas, EMPTY_FRAME_STATS, summarizeFrameDeltas, type FrameStats } from './frameStats';

const PUBLISH_INTERVAL_MS = 500;

/**
 * The UI thread appends frame deltas to a small chunk and hands it to JS every 500 ms (and on deactivation,
 * so a fling's tail counts), keeping per-frame work constant; JS applies the 6,000-frame cap.
 * NOTE: `.get()`/`.set()`/`.modify()`, not `.value`, which react-hooks v7's React Compiler rule flags as mutation.
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

  // `useFrameCallback` re-registers on each new identity, so this depends only on stable values.
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
