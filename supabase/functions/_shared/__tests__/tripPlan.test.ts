/** @jest-environment node */
// supabase/functions/_shared/__tests__/tripPlan.test.ts
import type { GarmentCategory } from '../catalog.ts';
import type { RuleGarment } from '../outfitRules.ts';
import { planTrip, tripDates, type TripContext } from '../tripPlan.ts';
import type { WeatherSummary } from '../weather.ts';

const idOf = (n: number): string => `20000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const garment = (n: number, category: GarmentCategory, extra: Partial<RuleGarment> = {}): RuleGarment => ({
  id: idOf(n),
  category,
  colors: ['black'],
  pattern: 'solid',
  formality: 2,
  seasons: [],
  warmth: 2,
  fit: 'regular',
  status: 'available',
  last_worn_at: null,
  wear_count: 0,
  suggest: true,
  updated_at: '2026-11-01T00:00:00Z',
  pinned_on: null,
  ...extra,
});

const MILD: WeatherSummary = { tempC: 21, condition: 'clear', band: 'mild', rain: false };
const COLD: WeatherSummary = { tempC: 6, condition: 'cloudy', band: 'cold', rain: false };
const HOT: WeatherSummary = { tempC: 32, condition: 'clear', band: 'hot', rain: false };

const CTX: TripContext = { occasion: null, lat: null, seed: 'user-1', dismissed: new Set() };

const days = (dates: readonly string[], weather: WeatherSummary | null) => dates.map((date) => ({ date, weather }));

const keyOf = (ids: readonly string[]): string => [...ids].sort().join(',');

describe('tripDates', () => {
  test('every day from start to end, across a year end', () => {
    expect(tripDates('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });

  test('a one-day trip', () => {
    expect(tripDates('2026-12-05', '2026-12-05')).toEqual(['2026-12-05']);
  });
});

describe('planTrip', () => {
  test('reuses packed pieces: three days from three tops and two bottoms pack five pieces, never repeating an outfit', () => {
    const closet = [garment(1, 't_shirt'), garment(2, 'shirt'), garment(3, 'blouse'), garment(4, 'jeans'), garment(5, 'pants'), garment(6, 'sneakers')];

    const plan = planTrip(closet, days(['2026-12-01', '2026-12-02', '2026-12-03'], MILD), CTX);

    const outfits = plan.days.map((day) => day.garmentIds ?? []);
    expect(outfits.every((ids) => ids.length === 3 && ids.includes(idOf(6)))).toBe(true);
    expect(new Set(outfits.map(keyOf)).size).toBe(3);
    expect(new Set(outfits.flat()).size).toBe(5);
  });

  test('repeats an outfit only when no other one passes', () => {
    const closet = [garment(1, 't_shirt'), garment(2, 'jeans'), garment(3, 'sneakers')];

    const plan = planTrip(closet, days(['2026-12-01', '2026-12-02'], MILD), CTX);

    expect(plan.days.map((day) => keyOf(day.garmentIds ?? []))).toEqual([keyOf([idOf(1), idOf(2), idOf(3)]), keyOf([idOf(1), idOf(2), idOf(3)])]);
  });

  test('the packing list holds each piece once, by slot, with the days it is worn', () => {
    const closet = [garment(1, 't_shirt'), garment(2, 'jeans'), garment(3, 'sneakers')];

    const plan = planTrip(closet, days(['2026-12-01', '2026-12-02'], MILD), CTX);

    expect(plan.packing).toEqual([
      { slot: 'top', items: [{ garmentId: idOf(1), days: 2 }] },
      { slot: 'bottom', items: [{ garmentId: idOf(2), days: 2 }] },
      { slot: 'shoes', items: [{ garmentId: idOf(3), days: 2 }] },
    ]);
  });

  test('a piece worn more days comes first in its group', () => {
    const closet = [garment(1, 't_shirt'), garment(2, 'shirt'), garment(3, 'jeans'), garment(4, 'sneakers')];

    const plan = planTrip(closet, days(['2026-12-01', '2026-12-02', '2026-12-03'], MILD), CTX);

    const tops = plan.packing.find((group) => group.slot === 'top')?.items ?? [];
    expect(tops.map((item) => item.days)).toEqual([2, 1]);
    expect(plan.packing.find((group) => group.slot === 'bottom')?.items).toEqual([{ garmentId: idOf(3), days: 3 }]);
  });

  test('follows each day’s weather band: a coat on the cold day, none on the hot one', () => {
    const closet = [garment(1, 't_shirt'), garment(2, 'jeans'), garment(3, 'sneakers'), garment(4, 'coat', { warmth: 3 })];

    const plan = planTrip(closet, [
      { date: '2026-12-01', weather: COLD },
      { date: '2026-12-02', weather: HOT },
    ], CTX);

    expect(plan.days[0]?.garmentIds).toContain(idOf(4));
    expect(plan.days[1]?.garmentIds).not.toContain(idOf(4));
  });

  test('a day past the forecast (no weather) still follows the season rule for its date and latitude', () => {
    const closet = [
      garment(1, 't_shirt', { seasons: ['summer'] }),
      garment(2, 'sweater', { seasons: ['winter'] }),
      garment(3, 'jeans'),
      garment(4, 'boots'),
    ];

    const plan = planTrip(closet, days(['2027-01-10', '2027-01-11'], null), { ...CTX, lat: 40.4 });

    expect(plan.days.map((day) => day.weather)).toEqual([null, null]);
    for (const day of plan.days) {
      expect(day.garmentIds).toContain(idOf(2));
      expect(day.garmentIds).not.toContain(idOf(1));
    }
  });

  test('a day nothing fits (the occasion’s formality) has no outfit and adds nothing to pack', () => {
    const closet = [garment(1, 't_shirt'), garment(2, 'jeans'), garment(3, 'sneakers')];

    const plan = planTrip(closet, days(['2026-12-01'], MILD), { ...CTX, occasion: 'event' });

    expect(plan.days).toEqual([{ date: '2026-12-01', weather: MILD, garmentIds: null }]);
    expect(plan.packing).toEqual([]);
  });

  test('never builds a dismissed combination or uses a piece out of suggestions', () => {
    const closet = [
      garment(1, 't_shirt'),
      garment(2, 'shirt'),
      garment(3, 'blouse', { suggest: false }),
      garment(4, 'jeans'),
      garment(5, 'sneakers'),
    ];
    const dismissed = new Set([keyOf([idOf(1), idOf(4), idOf(5)])]);

    const plan = planTrip(closet, days(['2026-12-01', '2026-12-02'], MILD), { ...CTX, dismissed });

    for (const day of plan.days) {
      expect(day.garmentIds).not.toContain(idOf(3));
      expect(keyOf(day.garmentIds ?? [])).not.toBe(keyOf([idOf(1), idOf(4), idOf(5)]));
    }
  });

  test('the same closet and trip give the same plan (a seeded draw)', () => {
    const closet = [garment(1, 't_shirt'), garment(2, 'shirt'), garment(3, 'jeans'), garment(4, 'pants'), garment(5, 'sneakers'), garment(6, 'boots')];
    const trip = days(['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'], MILD);

    expect(planTrip(closet, trip, CTX)).toEqual(planTrip(closet, trip, CTX));
  });
});
