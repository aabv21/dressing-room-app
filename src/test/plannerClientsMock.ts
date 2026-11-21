// A stand-in for the planner repository in suites that render the root layout or a route tree (Today
// refreshes the plans) but don't test the planner. The real module loads the Supabase client at
// import time. Use with:
//
//   jest.mock('../planner/plannedOutfits', () => require('../test/plannerClientsMock'));
//
// The read never settles, so the stored plans stay as they are; the writes succeed.

export const listPlans = jest.fn(() => new Promise<never>(() => undefined));
export const planOutfit = jest.fn((input: { day: string; garmentIds: readonly string[]; occasion: string | null }) =>
  Promise.resolve({ ok: true as const, plan: { id: 'plan-1', ...input, garmentIds: [...input.garmentIds] } }),
);
export const removePlan = jest.fn(() => Promise.resolve({ ok: true as const }));
