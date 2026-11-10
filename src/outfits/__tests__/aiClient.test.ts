jest.mock('../../lib/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';

import { fetchForYou, fetchLuckyList, localDate, rateOutfit } from '../aiClient';
import type { ForYouResponse, LuckyResponse } from '../types';
import type { RatingResult } from '../types';

type InvokeResult = { data: unknown; error: unknown };

/** A fake Supabase client exposing only the `functions.invoke` surface `aiClient.ts` calls. */
function fakeClient(invoke: (name: string, options: unknown) => Promise<InvokeResult>) {
  return { functions: { invoke: jest.fn(invoke) } } as unknown as Parameters<typeof rateOutfit>[1];
}

const RATE_INPUT = { garmentIds: ['g-1', 'g-2', 'g-3'], occasion: 'office' as const, date: '2026-11-10' };
const LUCKY_INPUT = { occasion: null, date: '2026-11-10' };

function httpError(status: number): FunctionsHttpError {
  return new FunctionsHttpError(new Response(null, { status }));
}

describe('rateOutfit', () => {
  test('a successful call passes the input through and returns the result', async () => {
    const result: RatingResult = {
      score: 82,
      label: 'good',
      confidence: 70,
      estimated: false,
      reasons: [],
      weakestSlot: null,
      swap: null,
      noBetterSwap: true,
    };
    const invoke = jest.fn(() => Promise.resolve({ data: result, error: null }));
    const client = fakeClient(invoke);

    const outcome = await rateOutfit(RATE_INPUT, client);

    expect(outcome).toEqual({ ok: true, result });
    expect(invoke).toHaveBeenCalledWith('rate-outfit', {
      body: { garment_ids: RATE_INPUT.garmentIds, occasion: RATE_INPUT.occasion, date: RATE_INPUT.date },
    });
  });

  test.each([
    [429, 'over_quota'],
    [503, 'unavailable'],
    [422, 'incomplete'],
    [404, 'not_found'],
    // An expired or rejected session (the gateway's verify_jwt) isn't one of the functions' codes.
    [401, 'unknown'],
    [500, 'unknown'],
    [400, 'unknown'],
  ] as const)('an HTTP %i response maps to %s', async (status, expected) => {
    const client = fakeClient(() => Promise.resolve({ data: null, error: httpError(status) }));

    expect(await rateOutfit(RATE_INPUT, client)).toEqual({ ok: false, error: expected });
  });

  test('a FunctionsFetchError maps to network', async () => {
    const client = fakeClient(() => Promise.resolve({ data: null, error: new FunctionsFetchError(new TypeError('boom')) }));

    expect(await rateOutfit(RATE_INPUT, client)).toEqual({ ok: false, error: 'network' });
  });

  test('a thrown TypeError maps to network', async () => {
    const client = fakeClient(() => Promise.reject(new TypeError('Network request failed')));

    expect(await rateOutfit(RATE_INPUT, client)).toEqual({ ok: false, error: 'network' });
  });

  test('an unrecognized thrown error maps to unknown', async () => {
    const client = fakeClient(() => Promise.reject(new Error('boom')));

    expect(await rateOutfit(RATE_INPUT, client)).toEqual({ ok: false, error: 'unknown' });
  });
});

describe('fetchLuckyList', () => {
  test('a successful call passes the input through and returns the result', async () => {
    const result: LuckyResponse = { kind: 'ok', weather: null, outfits: [] };
    const invoke = jest.fn(() => Promise.resolve({ data: result, error: null }));
    const client = fakeClient(invoke);

    const outcome = await fetchLuckyList(LUCKY_INPUT, client);

    expect(outcome).toEqual({ ok: true, result });
    expect(invoke).toHaveBeenCalledWith('lucky-list', {
      body: { occasion: LUCKY_INPUT.occasion, date: LUCKY_INPUT.date },
    });
  });

  test.each([
    [429, 'over_quota'],
    [503, 'unavailable'],
    [422, 'incomplete'],
    [404, 'not_found'],
  ] as const)('an HTTP %i response maps to %s', async (status, expected) => {
    const client = fakeClient(() => Promise.resolve({ data: null, error: httpError(status) }));

    expect(await fetchLuckyList(LUCKY_INPUT, client)).toEqual({ ok: false, error: expected });
  });

  test('a thrown TypeError maps to network', async () => {
    const client = fakeClient(() => Promise.reject(new TypeError('Network request failed')));

    expect(await fetchLuckyList(LUCKY_INPUT, client)).toEqual({ ok: false, error: 'network' });
  });
});

describe('fetchForYou', () => {
  test('a successful call sends the language and returns the ideas', async () => {
    const result: ForYouResponse = { kind: 'too_small' };
    const invoke = jest.fn(() => Promise.resolve({ data: result, error: null }));
    const client = fakeClient(invoke);

    const outcome = await fetchForYou({ language: 'es' }, client);

    expect(outcome).toEqual({ ok: true, result });
    expect(invoke).toHaveBeenCalledWith('for-you', { body: { language: 'es' } });
  });

  test.each([
    [429, 'over_quota'],
    [500, 'unknown'],
  ] as const)('an HTTP %i response maps to %s', async (status, expected) => {
    const client = fakeClient(() => Promise.resolve({ data: null, error: httpError(status) }));

    expect(await fetchForYou({ language: 'en' }, client)).toEqual({ ok: false, error: expected });
  });

  test('a fetch failure maps to network', async () => {
    const client = fakeClient(() => Promise.resolve({ data: null, error: new FunctionsFetchError(new TypeError('offline')) }));

    expect(await fetchForYou({ language: 'en' }, client)).toEqual({ ok: false, error: 'network' });
  });
});

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
