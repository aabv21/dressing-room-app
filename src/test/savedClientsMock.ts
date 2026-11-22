// Stand-ins for the saved-outfits repository in suites that render the Closet tab (or a route tree that
// lands on it) but don't test the Saved segment. The real module loads the Supabase client at import
// time. Use with:
//
//   jest.mock('../outfits/savedOutfits', () => require('../test/savedClientsMock'));
//
// The list read never settles, so Saved stays on its loading state; deletes succeed.

export const SAVED_LIMIT = 200;
export const listSavedOutfits = jest.fn(() => new Promise<never>(() => undefined));
export const deleteSavedOutfit = jest.fn(() => Promise.resolve({ ok: true as const }));
