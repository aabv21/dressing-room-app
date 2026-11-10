jest.mock('../../lib/supabase', () => ({
  supabase: { auth: {} },
}));

import { deleteWear, listWears } from '../wearsRepository';

type Client = NonNullable<Parameters<typeof listWears>[2]>;

function fakeClient(rows: { data: unknown; error: unknown; status?: number } = { data: [], error: null, status: 200 }) {
  const settled = () => Promise.resolve({ status: 200, ...rows });
  const builder: Record<string, jest.Mock> = Object.assign(
    { then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => settled().then(resolve, reject) },
    Object.fromEntries(
      ['select', 'gte', 'lte', 'order', 'eq', 'delete'].map((method) => [
        method,
        jest.fn(() => {
          calls.push(`db.${method}`);
          return builder;
        }),
      ]),
    ),
  );
  const from = jest.fn(() => builder);
  return { client: { from } as unknown as Client, from, builder };
}

const calls: string[] = [];

beforeEach(() => {
  calls.length = 0;
});

describe('listWears', () => {
  test('selects wears joined to their outfit items, filtered by date, newest first', async () => {
    const { client, from, builder } = fakeClient({
      data: [
        {
          id: 'w-2',
          worn_on: '2026-11-09',
          occasion: 'office',
          score: 82,
          outfits: { outfit_items: [{ garment_id: 'g-1' }, { garment_id: 'g-2' }] },
        },
        {
          id: 'w-1',
          worn_on: '2026-11-01',
          occasion: null,
          score: null,
          outfits: { outfit_items: [{ garment_id: 'g-3' }] },
        },
      ],
      error: null,
    });

    const result = await listWears('2026-11-01', '2026-11-09', client);

    expect(from).toHaveBeenCalledWith('wears');
    expect(builder['select']).toHaveBeenCalledWith(
      'id, worn_on, occasion, score, outfit_id, outfits(outfit_items(garment_id))',
    );
    expect(builder['gte']).toHaveBeenCalledWith('worn_on', '2026-11-01');
    expect(builder['lte']).toHaveBeenCalledWith('worn_on', '2026-11-09');
    expect(builder['order']).toHaveBeenNthCalledWith(1, 'worn_on', { ascending: false });
    expect(builder['order']).toHaveBeenNthCalledWith(2, 'created_at', { ascending: false });
    expect(result).toEqual([
      { id: 'w-2', wornOn: '2026-11-09', occasion: 'office', score: 82, garmentIds: ['g-1', 'g-2'] },
      { id: 'w-1', wornOn: '2026-11-01', occasion: null, score: null, garmentIds: ['g-3'] },
    ]);
  });

  test('a wear whose outfit join is missing gets an empty garment list', async () => {
    const { client } = fakeClient({
      data: [{ id: 'w-1', worn_on: '2026-11-01', occasion: null, score: null, outfits: null }],
      error: null,
    });

    const result = await listWears('2026-11-01', '2026-11-01', client);

    expect(result).toEqual([{ id: 'w-1', wornOn: '2026-11-01', occasion: null, score: null, garmentIds: [] }]);
  });

  test('throws on error', async () => {
    const { client } = fakeClient({ data: null, error: new Error('boom') });

    await expect(listWears('2026-11-01', '2026-11-09', client)).rejects.toThrow('boom');
  });
});

describe('deleteWear', () => {
  test('deletes the wear row by id', async () => {
    const { client, builder } = fakeClient({ data: [{ id: 'w-1' }], error: null });

    expect(await deleteWear('w-1', client)).toEqual({ ok: true });
    expect(builder['delete']).toHaveBeenCalled();
    expect(builder['eq']).toHaveBeenCalledWith('id', 'w-1');
  });

  test('a delete that reaches no row is an error', async () => {
    const { client } = fakeClient({ data: [], error: null });

    expect(await deleteWear('w-1', client)).toEqual({ ok: false, error: 'unknown' });
  });

  test('a rejected value maps to invalid, a fetch failure to network', async () => {
    const invalid = fakeClient({ data: null, error: { code: '23514', message: 'check' }, status: 400 });
    expect(await deleteWear('w-1', invalid.client)).toEqual({ ok: false, error: 'invalid' });

    const offline = fakeClient({ data: null, error: { code: '', message: 'offline' }, status: 0 });
    expect(await deleteWear('w-1', offline.client)).toEqual({ ok: false, error: 'network' });
  });
});
