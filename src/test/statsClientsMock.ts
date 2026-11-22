// Stand-ins for the wears repository in suites that render the Closet tab, Today or the rating (whose
// undo deletes a wear), or a route tree that lands on one, but don't test it. The real module loads
// the Supabase client at import time.
// Use with:
//
//   jest.mock('../stats/wearsRepository', () => require('../test/statsClientsMock'));
//
// The history read never settles, so Stats stays on its loading state; deletes succeed.

export const listWears = jest.fn(() => new Promise<never>(() => undefined));
export const deleteWear = jest.fn(() => Promise.resolve({ ok: true as const }));
