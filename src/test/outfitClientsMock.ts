// Stand-ins for the outfit AI client and repository in suites that render the root layout or a whole
// route tree (which lands on Today) but don't test outfits. The real modules load the Supabase client
// at import time. Use with:
//
//   jest.mock('../outfits/aiClient', () => require('../test/outfitClientsMock'));
//   jest.mock('../outfits/outfitRepository', () => require('../test/outfitClientsMock'));
//
// The AI calls never settle, so Today stays on its loading card; the writes succeed.

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

export const fetchLuckyList = jest.fn(never);
export const rateOutfit = jest.fn(never);
export const logWear = jest.fn(() => Promise.resolve({ ok: true as const }));
export const saveOutfit = jest.fn(() => Promise.resolve({ ok: true as const }));

export function localDate(): string {
  return '2026-11-08';
}
