jest.mock('../../lib/supabase', () => ({
  supabase: { auth: {} },
}));

import { deleteWear, listWears, WEARS_MAX_PAGES, WEARS_PAGE_SIZE } from '../wearsRepository';

type Client = NonNullable<Parameters<typeof listWears>[2]>;

function fakeClient(rows: { data: unknown; error: unknown; status?: number } = { data: [], error: null, status: 200 }) {
  const settled = () => Promise.resolve({ status: 200, ...rows });
  const builder: Record<string, jest.Mock> = Object.assign(
    { then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => settled().then(resolve, reject) },
    Object.fromEntries(
      ['select', 'gte', 'lte', 'order', 'range', 'eq', 'delete'].map((method) => [
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
    // A total order, so consecutive pages never repeat or skip a row.
    expect(builder['order']).toHaveBeenNthCalledWith(3, 'id', { ascending: false });
    expect(builder['range']).toHaveBeenCalledWith(0, WEARS_PAGE_SIZE - 1);
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

/** A fake client holding `total` wears (newest first) that answers each `.range(a, b)` with that slice. */
function pagedClient(total: number, failOnPage?: number) {
  const ranges: [number, number][] = [];
  const row = (index: number) => ({
    id: `w-${String(index)}`,
    worn_on: '2026-11-09',
    occasion: null,
    score: null,
    outfits: { outfit_items: [{ garment_id: 'g-1' }] },
  });
  const from = jest.fn(() => {
    let range: [number, number] = [0, Number.MAX_SAFE_INTEGER];
    const builder: Record<string, unknown> = {
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
        const [start, end] = range;
        const page = ranges.length - 1;
        const result =
          page === failOnPage
            ? { data: null, error: new Error('page failed'), status: 500 }
            : {
                data: Array.from({ length: Math.max(0, Math.min(end, total - 1) - start + 1) }, (_, offset) => row(start + offset)),
                error: null,
                status: 200,
              };
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    const chain = jest.fn(() => builder);
    Object.assign(builder, {
      select: chain,
      gte: chain,
      lte: chain,
      order: chain,
      range: jest.fn((start: number, end: number) => {
        range = [start, end];
        ranges.push(range);
        return builder;
      }),
    });
    return builder;
  });
  return { client: { from } as unknown as Client, ranges };
}

describe('listWears paging', () => {
  test('reads pages of 1000 until one comes back short, keeping the order', async () => {
    const { client, ranges } = pagedClient(2500);

    const result = await listWears('2025-11-09', '2026-11-09', client);

    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    expect(result).toHaveLength(2500);
    expect(result[0]?.id).toBe('w-0');
    expect(result[1000]?.id).toBe('w-1000');
    expect(result.at(-1)?.id).toBe('w-2499');
  });

  test('a full last page is followed by one empty page', async () => {
    const { client, ranges } = pagedClient(1000);

    const result = await listWears('2025-11-09', '2026-11-09', client);

    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(result).toHaveLength(1000);
  });

  test(`stops after ${String(WEARS_MAX_PAGES)} pages`, async () => {
    const { client, ranges } = pagedClient(1_000_000);

    const result = await listWears('2025-11-09', '2026-11-09', client);

    expect(ranges).toHaveLength(WEARS_MAX_PAGES);
    expect(result).toHaveLength(WEARS_MAX_PAGES * WEARS_PAGE_SIZE);
  });

  test('a failed later page throws, returning nothing partial', async () => {
    const { client } = pagedClient(2500, 1);

    await expect(listWears('2025-11-09', '2026-11-09', client)).rejects.toThrow('page failed');
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
