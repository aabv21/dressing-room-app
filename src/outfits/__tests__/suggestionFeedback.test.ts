jest.mock('../../lib/supabase', () => ({
  supabase: { auth: {} },
}));

import { dismissOutfit, stopSuggesting } from '../suggestionFeedback';

type Client = NonNullable<Parameters<typeof dismissOutfit>[1]>;

function fakeClient(outcome: { data?: unknown; error?: unknown; status?: number } = {}) {
  const upsert = jest.fn(() => Promise.resolve({ data: outcome.data ?? null, error: outcome.error ?? null, status: outcome.status ?? 201 }));
  const from = jest.fn(() => ({ upsert }));
  return { client: { from } as unknown as Client, from, upsert };
}

test('stores the outfit key (its ids sorted and joined), ignoring a repeat', async () => {
  const { client, from, upsert } = fakeClient();

  expect(await dismissOutfit(['g-3', 'g-1', 'g-2'], client)).toEqual({ ok: true });
  expect(from).toHaveBeenCalledWith('dismissed_outfits');
  expect(upsert).toHaveBeenCalledWith({ outfit_key: 'g-1,g-2,g-3' }, { onConflict: 'user_id,outfit_key', ignoreDuplicates: true });
});

test('a fetch failure maps to network', async () => {
  const { client } = fakeClient({ error: { code: '', message: 'offline' }, status: 0 });
  expect(await dismissOutfit(['g-1', 'g-2'], client)).toEqual({ ok: false, error: 'network' });
});

test('stopSuggesting sets the garment’s suggest to false and needs the row to exist', async () => {
  const settled = (data: unknown) => {
    const select = jest.fn(() => Promise.resolve({ data, error: null, status: 200 }));
    const eq = jest.fn(() => ({ select }));
    const update = jest.fn(() => ({ eq }));
    const from = jest.fn(() => ({ update }));
    return { client: { from } as unknown as Client, from, update, eq };
  };
  const found = settled([{ id: 'g-1' }]);
  expect(await stopSuggesting('g-1', found.client)).toEqual({ ok: true });
  expect(found.from).toHaveBeenCalledWith('garments');
  expect(found.update).toHaveBeenCalledWith({ suggest: false });
  expect(found.eq).toHaveBeenCalledWith('id', 'g-1');
  expect(await stopSuggesting('g-1', settled([]).client)).toEqual({ ok: false, error: 'unknown' });
});
