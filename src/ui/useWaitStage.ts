// How long an AI wait has run, so its copy can say it's still working (the answers can take 45 s).
import { useEffect, useState } from 'react';

export const WAIT_LONG_MS = 6000;
export const WAIT_LONGER_MS = 20000;

export type WaitStage = 'start' | 'long' | 'longer';

/** `start` until `WAIT_LONG_MS`, `long` until `WAIT_LONGER_MS`, then `longer`; each new wait starts over. */
export function useWaitStage(waiting: boolean): WaitStage {
  const [stage, setStage] = useState<WaitStage>('start');
  const [waited, setWaited] = useState(waiting);
  if (waited !== waiting) {
    // Storing derived state during render (React's documented pattern): a wait began or ended.
    setWaited(waiting);
    setStage('start');
  }
  useEffect(() => {
    if (!waiting) return undefined;
    const long = setTimeout(() => {
      setStage('long');
    }, WAIT_LONG_MS);
    const longer = setTimeout(() => {
      setStage('longer');
    }, WAIT_LONGER_MS);
    return () => {
      clearTimeout(long);
      clearTimeout(longer);
    };
  }, [waiting]);
  return waiting ? stage : 'start';
}
