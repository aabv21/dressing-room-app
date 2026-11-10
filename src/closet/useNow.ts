import { useEffect, useState } from 'react';

/**
 * The current time, re-read every `intervalMs`, for render-time derivations that depend on the
 * clock (e.g. a pending garment turning stale after 10 minutes) without calling `Date.now()`
 * during render.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [intervalMs]);
  return now;
}
