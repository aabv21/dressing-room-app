import { appendFrameDeltas, inferRefreshRateHz, summarizeFrameDeltas } from '../frameStats';

test('empty input is all zeros', () => {
  expect(summarizeFrameDeltas([])).toEqual({
    frames: 0,
    dropped: 0,
    droppedRatio: 0,
    p95Ms: 0,
    medianMs: 0,
  });
});

test('60 Hz: a delta above 1.5× the median counts as dropped', () => {
  const d = [...Array<number>(95).fill(16.7), 40, 40, 40, 40, 40];
  const s = summarizeFrameDeltas(d);
  expect(s.frames).toBe(100);
  expect(s.dropped).toBe(5);
  expect(s.droppedRatio).toBeCloseTo(0.05);
  expect(s.p95Ms).toBeCloseTo(16.7, 1);
  expect(s.medianMs).toBeCloseTo(16.7, 1);
});

test('120 Hz ProMotion: 16.7 ms frames are drops when the median is 8.3 ms', () => {
  const s = summarizeFrameDeltas([...Array<number>(90).fill(8.3), ...Array<number>(10).fill(16.7)]);
  expect(s.dropped).toBe(10);
  expect(s.medianMs).toBeCloseTo(8.3, 1);
});

test('the refresh rate is inferred from the median frame time', () => {
  expect(inferRefreshRateHz(8.33)).toBe(120);
  expect(inferRefreshRateHz(16.7)).toBe(60);
  expect(inferRefreshRateHz(0)).toBe(0);
});

test('appending a chunk keeps arrival order and does not mutate its inputs', () => {
  const buffer = [1, 2];
  const chunk = [3, 4];
  expect(appendFrameDeltas(buffer, chunk, 10)).toEqual([1, 2, 3, 4]);
  expect(buffer).toEqual([1, 2]);
  expect(chunk).toEqual([3, 4]);
});

test('appending past the cap keeps only the newest deltas', () => {
  expect(appendFrameDeltas([1, 2, 3], [4, 5], 4)).toEqual([2, 3, 4, 5]);
  expect(appendFrameDeltas([1], [2, 3, 4, 5, 6], 3)).toEqual([4, 5, 6]);
});

test('the default cap is 6,000 deltas', () => {
  const full = Array.from({ length: 6000 }, (_, i) => i);
  const next = appendFrameDeltas(full, [6000]);
  expect(next).toHaveLength(6000);
  expect(next[0]).toBe(1);
  expect(next.at(-1)).toBe(6000);
});
