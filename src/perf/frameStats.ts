export type FrameStats = {
  frames: number;
  dropped: number;
  droppedRatio: number;
  p95Ms: number;
};

const EMPTY_STATS: FrameStats = { frames: 0, dropped: 0, droppedRatio: 0, p95Ms: 0 };

/**
 * Summarizes a buffer of per-frame deltas (ms between consecutive frames) into drop-rate and
 * tail-latency stats. A frame counts as "dropped" when it took more than 1.5x the median delta,
 * which adapts to both 60 Hz (~16.7 ms) and 120 Hz ProMotion (~8.3 ms) displays without a
 * hardcoded target frame time.
 */
export function summarizeFrameDeltas(deltasMs: readonly number[]): FrameStats {
  const frames = deltasMs.length;
  if (frames === 0) {
    return EMPTY_STATS;
  }

  const sorted = [...deltasMs].sort((a, b) => a - b);
  const medianIndex = Math.floor(frames / 2);
  const median = sorted[medianIndex] ?? 0;
  const dropThreshold = median * 1.5;
  const dropped = sorted.reduce((count, delta) => (delta > dropThreshold ? count + 1 : count), 0);
  const p95Index = Math.ceil(0.95 * frames) - 1;
  const p95Ms = sorted[p95Index] ?? 0;

  return {
    frames,
    dropped,
    droppedRatio: dropped / frames,
    p95Ms,
  };
}
