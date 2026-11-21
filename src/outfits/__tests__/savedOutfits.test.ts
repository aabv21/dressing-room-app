jest.mock('../../lib/supabase', () => ({
  supabase: { auth: {} },
}));

import { deleteSavedOutfit, listSavedOutfits, SAVED_LIMIT } from '../savedOutfits';

type Client = NonNullable<Parameters<typeof listSavedOutfits>[0]>;

function fakeClient(rows: { data: unknown; error: unknown; status?: number }) {
  const settled = () => Promise.resolve({ status: 200, ...rows });
  const builder: Record<string, jest.Mock> = Object.assign(
    { then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => settled().then(resolve, reject) },
    Object.fromEntries(
      ['select', 'not', 'order', 'limit', 'eq', 'delete'].map((method) => [method, jest.fn(() => builder)]),
    ),
  );
  const from = jest.fn(() => builder);
  return { client: { from } as unknown as Client, from, builder };
}

describe('listSavedOutfits', () => {
  test('selects saved outfits with their items, newest first, capped', async () => {
    const { client, from, builder } = fakeClient({
      data: [
        { id: 'o-2', saved_at: '2026-11-20T10:00:00Z', score: 82, outfit_items: [{ garment_id: 'g-1' }, { garment_id: 'g-2' }] },
        { id: 'o-1', saved_at: '2026-11-01T10:00:00Z', score: null, outfit_items: [{ garment_id: 'g-3' }] },
      ],
      error: null,
    });

    const result = await listSavedOutfits(client);

    expect(from).toHaveBeenCalledWith('outfits');
    expect(builder['select']).toHaveBeenCalledWith('id, saved_at, score, outfit_items(garment_id)');
    expect(builder['not']).toHaveBeenCalledWith('saved_at', 'is', null);
    expect(builder['order']).toHaveBeenNthCalledWith(1, 'saved_at', { ascending: false });
    expect(builder['limit']).toHaveBeenCalledWith(SAVED_LIMIT);
    expect(result).toEqual([
      { id: 'o-2', savedAt: '2026-11-20T10:00:00Z', score: 82, garmentIds: ['g-1', 'g-2'] },
      { id: 'o-1', savedAt: '2026-11-01T10:00:00Z', score: null, garmentIds: ['g-3'] },
    ]);
  });

  test('throws on a failed read', async () => {
    const { client } = fakeClient({ data: null, error: { code: '', message: 'offline' }, status: 0 });
    await expect(listSavedOutfits(client)).rejects.toBeTruthy();
  });
});

describe('deleteSavedOutfit', () => {
  test('deletes the outfit row by id (its items cascade)', async () => {
    const { client, from, builder } = fakeClient({ data: [{ id: 'o-1' }], error: null });

    expect(await deleteSavedOutfit('o-1', client)).toEqual({ ok: true });
    expect(from).toHaveBeenCalledWith('outfits');
    expect(builder['delete']).toHaveBeenCalled();
    expect(builder['eq']).toHaveBeenCalledWith('id', 'o-1');
  });

  test('a delete that reaches no row (gone, worn, or not the caller’s) is an error', async () => {
    const { client } = fakeClient({ data: [], error: null });
    expect(await deleteSavedOutfit('o-1', client)).toEqual({ ok: false, error: 'unknown' });
  });

  test('a fetch failure maps to network', async () => {
    const { client } = fakeClient({ data: null, error: { code: '', message: 'offline' }, status: 0 });
    expect(await deleteSavedOutfit('o-1', client)).toEqual({ ok: false, error: 'network' });
  });
});
