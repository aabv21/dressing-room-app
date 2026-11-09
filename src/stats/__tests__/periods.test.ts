import { addDays, monthGrid, periodRange } from '../periods';

describe('addDays', () => {
  test('shifts a day string forward and backward across month and year boundaries', () => {
    expect(addDays('2026-11-09', 1)).toBe('2026-11-10');
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-01-02', -3)).toBe('2025-12-30');
  });
});

describe('periodRange', () => {
  test('week is the last 7 local days including today', () => {
    expect(periodRange('week', '2026-11-09')).toEqual({ from: '2026-11-03', to: '2026-11-09' });
  });

  test('month starts on the 1st of the current calendar month', () => {
    expect(periodRange('month', '2026-11-09')).toEqual({ from: '2026-11-01', to: '2026-11-09' });
  });

  test('sixMonths spans 182 days including today', () => {
    const { from, to } = periodRange('sixMonths', '2026-11-09');
    expect(to).toBe('2026-11-09');
    const fromMs = Date.parse(`${from}T00:00:00Z`);
    const toMs = Date.parse(`${to}T00:00:00Z`);
    expect((toMs - fromMs) / (24 * 60 * 60 * 1000) + 1).toBe(182);
  });

  test('week crosses a year boundary correctly', () => {
    expect(periodRange('week', '2026-01-02')).toEqual({ from: '2025-12-27', to: '2026-01-02' });
  });
});

describe('monthGrid', () => {
  test('February 2026 starts on Monday 26 January and has 42 cells', () => {
    const grid = monthGrid(2026, 2);
    expect(grid).toHaveLength(42);
    expect(grid[0]).toEqual({ day: '2026-01-26', inMonth: false });
    // February 2026 has 28 days, 1-28.
    expect(grid.find((cell) => cell.day === '2026-02-01')).toEqual({ day: '2026-02-01', inMonth: true });
    expect(grid.find((cell) => cell.day === '2026-02-28')).toEqual({ day: '2026-02-28', inMonth: true });
  });

  test('a 31-day month that ends on a Sunday lays out correctly', () => {
    // March 2026: 1 March 2026 is a Sunday, so the grid starts Monday 23 February.
    const grid = monthGrid(2026, 3);
    expect(grid).toHaveLength(42);
    expect(grid[0]).toEqual({ day: '2026-02-23', inMonth: false });
    const march31 = grid.find((cell) => cell.day === '2026-03-31');
    expect(march31).toEqual({ day: '2026-03-31', inMonth: true });
    // 31 March 2026 is a Tuesday, so it's not the last day in its grid row (Monday-first).
    const index = grid.findIndex((cell) => cell.day === '2026-03-31');
    expect(index % 7).toBe(1);
  });
});
