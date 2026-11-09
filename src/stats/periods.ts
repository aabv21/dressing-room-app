// Date math for the Stats and Diary segments: local calendar days as `YYYY-MM-DD` strings, with
// all arithmetic done through UTC-anchored `Date` objects so it never shifts with the host's
// timezone (midnight in one zone is not midnight in `Date`'s local time).

export type Period = 'week' | 'month' | 'sixMonths';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Parses a `YYYY-MM-DD` string as a UTC instant (midnight UTC that day). */
function toUtcDate(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, date ?? 1));
}

/** Formats a UTC instant back to `YYYY-MM-DD`, reading the UTC fields (never local time). */
function toDayString(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dayOfMonth = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${dayOfMonth}`;
}

/** `day` shifted by `n` days (negative goes back), still `YYYY-MM-DD`. */
export function addDays(day: string, n: number): string {
  return toDayString(new Date(toUtcDate(day).getTime() + n * DAY_MS));
}

/** The inclusive `[from, to]` local-day range for `period`, ending on `today`. */
export function periodRange(period: Period, today: string): { from: string; to: string } {
  if (period === 'week') {
    return { from: addDays(today, -6), to: today };
  }
  if (period === 'month') {
    return { from: `${today.slice(0, 7)}-01`, to: today };
  }
  return { from: addDays(today, -181), to: today };
}

/** Monday-first day-of-week index (0 = Monday … 6 = Sunday); `Date.getUTCDay()` is Sunday-first. */
function mondayFirstDow(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

/**
 * The 42 cells (6 full Monday-first weeks) of `month`'s calendar grid, including the trailing and
 * leading days of the neighboring months so the grid is always complete.
 */
export function monthGrid(year: number, month: number): { day: string; inMonth: boolean }[] {
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(firstOfMonth.getTime() - mondayFirstDow(firstOfMonth) * DAY_MS);

  const cells: { day: string; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i += 1) {
    const cellDate = new Date(start.getTime() + i * DAY_MS);
    cells.push({ day: toDayString(cellDate), inMonth: cellDate.getUTCMonth() === month - 1 });
  }
  return cells;
}
