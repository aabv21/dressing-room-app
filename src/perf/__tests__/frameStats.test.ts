import { summarizeFrameDeltas } from '../frameStats';

test('empty input is all zeros', () => {
  expect(summarizeFrameDeltas([])).toEqual({ frames: 0, dropped: 0, droppedRatio: 0, p95Ms: 0 });
});

test('60 Hz: a delta above 1.5× the median counts as dropped', () => {
  const d = [...Array<number>(95).fill(16.7), 40, 40, 40, 40, 40];
  const s = summarizeFrameDeltas(d);
  expect(s.frames).toBe(100);
  expect(s.dropped).toBe(5);
  expect(s.droppedRatio).toBeCloseTo(0.05);
  expect(s.p95Ms).toBeCloseTo(16.7, 1);
});

test('120 Hz ProMotion: 16.7 ms frames are drops when the median is 8.3 ms', () => {
  const s = summarizeFrameDeltas([...Array<number>(90).fill(8.3), ...Array<number>(10).fill(16.7)]);
  expect(s.dropped).toBe(10);
});
