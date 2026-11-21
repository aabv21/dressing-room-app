jest.mock('../../lib/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

import { FunctionsHttpError } from '@supabase/supabase-js';

import { isTripResponse, planTripRequest, type TripResponse } from '../tripClient';

type InvokeResult = { data: unknown; error: unknown };

function fakeClient(invoke: (name: string, options: unknown) => Promise<InvokeResult>) {
  return { functions: { invoke: jest.fn(invoke) } } as unknown as Parameters<typeof planTripRequest>[1];
}

const OK: TripResponse = {
  kind: 'ok',
  city: 'Lisboa',
  days: [
    { date: '2026-12-01', weather: { tempC: 18, condition: 'clear', band: 'cool', rain: false }, garmentIds: ['g-1', 'g-2', 'g-3'] },
    { date: '2026-12-02', weather: null, garmentIds: null },
  ],
  packing: [{ slot: 'top', items: [{ garmentId: 'g-1', days: 1 }] }],
};

const INPUT = { city: 'Lisboa', start: '2026-12-01', end: '2026-12-02', occasion: null, language: 'es' as const, date: '2026-11-21' };

test('sends the trip with the local day and answers the plan', async () => {
  const invoke = jest.fn(() => Promise.resolve({ data: OK, error: null }));

  expect(await planTripRequest(INPUT, fakeClient(invoke))).toEqual({ ok: true, result: OK });
  expect(invoke).toHaveBeenCalledWith('trip-plan', {
    body: { city: 'Lisboa', start: '2026-12-01', end: '2026-12-02', occasion: null, language: 'es', date: '2026-11-21' },
  });
});

test.each([
  [404, 'not_found'],
  [429, 'over_quota'],
  [503, 'unavailable'],
  [500, 'unknown'],
] as const)('a %i is %s', async (status, error) => {
  const client = fakeClient(() => Promise.resolve({ data: null, error: new FunctionsHttpError(new Response(null, { status })) }));
  expect(await planTripRequest(INPUT, client)).toEqual({ ok: false, error });
});

test('isTripResponse: the plan and too_small; anything else is refused', () => {
  expect(isTripResponse(OK)).toBe(true);
  expect(isTripResponse({ kind: 'too_small', missing: ['shoes'] })).toBe(true);
  expect(isTripResponse({ ...OK, days: [{ date: '2026-12-01', weather: 'sunny', garmentIds: null }] })).toBe(false);
  expect(isTripResponse({ ...OK, packing: [{ slot: 'pocket', items: [] }] })).toBe(false);
  expect(isTripResponse({ kind: 'ok' })).toBe(false);
});
