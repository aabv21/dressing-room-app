jest.mock('../../lib/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

import { FunctionsHttpError } from '@supabase/supabase-js';

import { type BuyCheckResponse, checkPurchase, isBuyCheckResponse } from '../buyCheckClient';

type InvokeResult = { data: unknown; error: unknown };

function fakeClient(invoke: (name: string, options: unknown) => Promise<InvokeResult>) {
  return { functions: { invoke: jest.fn(invoke) } } as unknown as Parameters<typeof checkPurchase>[1];
}

const OK: BuyCheckResponse = {
  kind: 'ok',
  item: {
    category: 'jeans',
    colors: ['navy'],
    pattern: 'solid',
    material: 'denim',
    formality: 2,
    seasons: ['autumn'],
    warmth: 2,
    fit: 'regular',
    occasions: ['university'],
  },
  duplicates: [{ id: 'g-1' }],
  newOutfits: 3,
  verdict: 'skip',
};

const INPUT = { image: 'UklGRg==', date: '2026-11-21', language: 'es' as const };

test('sends the photo as a WebP with the local day and the language, and answers the comparison', async () => {
  const invoke = jest.fn(() => Promise.resolve({ data: OK, error: null }));

  expect(await checkPurchase(INPUT, fakeClient(invoke))).toEqual({ ok: true, result: OK });
  expect(invoke).toHaveBeenCalledWith('buy-check', {
    body: { image: 'UklGRg==', mediaType: 'image/webp', date: '2026-11-21', language: 'es' },
  });
});

test.each([
  [429, 'over_quota'],
  [503, 'unavailable'],
  [413, 'unknown'],
  [500, 'unknown'],
] as const)('a %i is %s', async (status, error) => {
  const client = fakeClient(() => Promise.resolve({ data: null, error: new FunctionsHttpError(new Response(null, { status })) }));
  expect(await checkPurchase(INPUT, client)).toEqual({ ok: false, error });
});

test('isBuyCheckResponse: the comparison and not_garment; anything else is refused', () => {
  expect(isBuyCheckResponse(OK)).toBe(true);
  expect(isBuyCheckResponse({ kind: 'not_garment' })).toBe(true);
  expect(isBuyCheckResponse({ ...OK, verdict: 'maybe' })).toBe(false);
  expect(isBuyCheckResponse({ ...OK, newOutfits: -1 })).toBe(false);
  expect(isBuyCheckResponse({ ...OK, newOutfits: 2.5 })).toBe(false);
  expect(isBuyCheckResponse({ ...OK, duplicates: [{ id: 7 }] })).toBe(false);
  expect(isBuyCheckResponse({ ...OK, duplicates: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] })).toBe(false);
  expect(isBuyCheckResponse({ ...OK, item: { ...OK.item, category: 'formal_gown' } })).toBe(false);
  expect(isBuyCheckResponse({ ...OK, item: { ...OK.item, colors: ['ultraviolet'] } })).toBe(false);
  expect(isBuyCheckResponse({ kind: 'too_small' })).toBe(false);
  expect(isBuyCheckResponse(null)).toBe(false);
});
