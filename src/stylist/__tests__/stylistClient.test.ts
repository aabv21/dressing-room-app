jest.mock('../../lib/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

import { FunctionsHttpError } from '@supabase/supabase-js';

import { askStylist, type ChatTurn, historyForRequest, isStylistResponse, type StylistResponse } from '../stylistClient';

type InvokeResult = { data: unknown; error: unknown };

function fakeClient(invoke: (name: string, options: unknown) => Promise<InvokeResult>) {
  return { functions: { invoke: jest.fn(invoke) } } as unknown as Parameters<typeof askStylist>[1];
}

const ID = '40000000-0000-4000-8000-000000000001';
const OK: StylistResponse = { kind: 'ok', reply: 'Try the navy jeans.', outfit: { garment_ids: [ID] } };
const TURNS: ChatTurn[] = [{ role: 'user', text: 'What should I wear?' }];

test('sends the turns with the local day and the language, and answers the reply', async () => {
  const invoke = jest.fn(() => Promise.resolve({ data: OK, error: null }));
  expect(await askStylist({ messages: TURNS, date: '2026-11-21', language: 'es' }, fakeClient(invoke))).toEqual({ ok: true, result: OK });
  expect(invoke).toHaveBeenCalledWith('stylist', { body: { messages: TURNS, date: '2026-11-21', language: 'es' } });
});

test.each([
  [429, 'over_quota'],
  [503, 'unavailable'],
  [400, 'unknown'],
  [500, 'unknown'],
] as const)('a %i is %s', async (status, error) => {
  const client = fakeClient(() => Promise.resolve({ data: null, error: new FunctionsHttpError(new Response(null, { status })) }));
  expect(await askStylist({ messages: TURNS, date: '2026-11-21', language: 'en' }, client)).toEqual({ ok: false, error });
});

test('isStylistResponse: a reply with or without an outfit; anything else is refused', () => {
  expect(isStylistResponse(OK)).toBe(true);
  expect(isStylistResponse({ kind: 'ok', reply: 'Hi' })).toBe(true);
  expect(isStylistResponse({ kind: 'ok', reply: '' })).toBe(false);
  expect(isStylistResponse({ kind: 'ok', reply: 'x'.repeat(501) })).toBe(false);
  expect(isStylistResponse({ kind: 'ok', reply: 42 })).toBe(false);
  expect(isStylistResponse({ ...OK, outfit: { garment_ids: [] } })).toBe(false);
  expect(isStylistResponse({ ...OK, outfit: { garment_ids: ['not-an-id'] } })).toBe(false);
  expect(isStylistResponse({ ...OK, outfit: { garment_ids: Array.from({ length: 7 }, () => ID) } })).toBe(false);
  expect(isStylistResponse({ kind: 'other', reply: 'Hi' })).toBe(false);
});

describe('historyForRequest', () => {
  const turn = (role: ChatTurn['role'], text: string): ChatTurn => ({ role, text });

  test('keeps the last 12 turns, starting with the user', () => {
    const chat = Array.from({ length: 15 }, (_, n) => turn(n % 2 === 0 ? 'user' : 'assistant', `t${String(n)}`));
    const sent = historyForRequest(chat);
    expect(sent.length).toBeLessThanOrEqual(12);
    expect(sent[0]?.role).toBe('user');
    expect(sent.at(-1)).toEqual(turn('user', 't14'));
  });

  test('drops the oldest turns until the total fits 4,000 characters', () => {
    const chat = [turn('user', 'a'.repeat(500)), turn('assistant', 'b'.repeat(500))];
    for (let n = 0; n < 4; n += 1) chat.push(turn('user', 'c'.repeat(500)), turn('assistant', 'd'.repeat(500)));
    chat.push(turn('user', 'last'));
    const sent = historyForRequest(chat);
    expect(sent.reduce((sum, item) => sum + Array.from(item.text).length, 0)).toBeLessThanOrEqual(4000);
    expect(sent[0]?.role).toBe('user');
    expect(sent.at(-1)?.text).toBe('last');
  });
});
