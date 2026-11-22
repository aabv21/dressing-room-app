import { localDate } from '../localDate';

describe('localDate', () => {
  test('gives the device local YYYY-MM-DD for a fixed date', () => {
    expect(localDate(new Date(2026, 10, 8, 23, 30))).toBe('2026-11-08');
  });

  test('pads single-digit months and days', () => {
    expect(localDate(new Date(2026, 0, 5, 0, 0))).toBe('2026-01-05');
  });

  test('defaults to now when no date is given', () => {
    const before = new Date();
    const result = localDate();
    const after = new Date();

    expect(result >= localDate(before)).toBe(true);
    expect(result <= localDate(after)).toBe(true);
  });
});
