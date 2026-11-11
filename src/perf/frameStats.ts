export type FrameStats = {
  frames: number;
  dropped: number;
  droppedRatio: number;
  p95Ms: number;
  medianMs: number;
};

export const EMPTY_FRAME_STATS: FrameStats = {
  frames: 0,
  dropped: 0,
  droppedRatio: 0,
  p95Ms: 0,
  medianMs: 0,
};

/** ~50 s of frames at 120 Hz, so a long scroll session can't grow the buffer unbounded. */
export const MAX_BUFFERED_FRAMES = 6000;

/**
 * Summarizes a buffer of per-frame deltas (ms between consecutive frames) into drop-rate and
 * tail-latency stats. A frame counts as "dropped" when it took more than 1.5x the median delta,
 * which adapts to both 60 Hz (~16.7 ms) and 120 Hz ProMotion (~8.3 ms) displays without a
 * hardcoded target frame time.
 */
export function summarizeFrameDeltas(deltasMs: readonly number[]): FrameStats {
  const frames = deltasMs.length;
  if (frames === 0) {
    return EMPTY_FRAME_STATS;
  }

  const sorted = [...deltasMs].sort((a, b) => a - b);
  const medianIndex = Math.floor(frames / 2);
  const medianMs = sorted.at(medianIndex) ?? 0;
  const dropThreshold = medianMs * 1.5;
  const dropped = sorted.reduce((count, delta) => (delta > dropThreshold ? count + 1 : count), 0);
  const p95Index = Math.ceil(0.95 * frames) - 1;
  const p95Ms = sorted.at(p95Index) ?? 0;

  return {
    frames,
    dropped,
    droppedRatio: dropped / frames,
    p95Ms,
    medianMs,
  };
}

/** The display refresh rate implied by a median frame time, e.g. 8.3 ms -> 120 Hz. */
export function inferRefreshRateHz(medianMs: number): number {
  return medianMs > 0 ? Math.round(1000 / medianMs) : 0;
}

/**
 * Returns `buffer` followed by `chunk`, keeping only the newest `cap` deltas. Runs on the JS
 * thread, once per published chunk, so the UI thread never copies the whole buffer.
 */
export function appendFrameDeltas(
  buffer: readonly number[],
  chunk: readonly number[],
  cap: number = MAX_BUFFERED_FRAMES,
): number[] {
  const combined = [...buffer, ...chunk];
  return combined.length > cap ? combined.slice(combined.length - cap) : combined;
}
