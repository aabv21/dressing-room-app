jest.mock('../../lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

import { logWear, saveOutfit } from '../outfitRepository';

type Client = NonNullable<Parameters<typeof logWear>[1]>;

function fakeClient(outcome: { data?: unknown; error?: unknown; status?: number } = {}) {
  const rpc = jest.fn(() =>
    Promise.resolve({ data: outcome.data ?? 'wear-1', error: outcome.error ?? null, status: outcome.status ?? 200 }),
  );
  return { client: { rpc } as unknown as Client, rpc };
}

const WEAR_ID = '11111111-1111-1111-1111-111111111111';

describe('logWear', () => {
  test('calls log_wear with the garment ids, date, occasion and score', async () => {
    const { client, rpc } = fakeClient();

    const result = await logWear(
      { wearId: WEAR_ID, garmentIds: ['g-1', 'g-2'], wornOn: '2026-11-08', occasion: 'office', score: 82 },
      client,
    );

    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('log_wear', {
      p_wear_id: WEAR_ID,
      p_garment_ids: ['g-1', 'g-2'],
      p_worn_on: '2026-11-08',
      p_occasion: 'office',
      p_score: 82,
    });
  });

  test('omits occasion and score from the call when they are null', async () => {
    const { client, rpc } = fakeClient();

    await logWear({ wearId: WEAR_ID, garmentIds: ['g-1'], wornOn: '2026-11-08', occasion: null, score: null }, client);

    expect(rpc).toHaveBeenCalledWith('log_wear', {
      p_wear_id: WEAR_ID,
      p_garment_ids: ['g-1'],
      p_worn_on: '2026-11-08',
    });
  });

  test('a network error (status 0) maps to the network RequestResult', async () => {
    const { client } = fakeClient({ data: null, error: { code: '', message: 'offline' }, status: 0 });

    const result = await logWear(
      { wearId: WEAR_ID, garmentIds: ['g-1'], wornOn: '2026-11-08', occasion: null, score: null },
      client,
    );

    expect(result).toEqual({ ok: false, error: 'network' });
  });
});

describe('saveOutfit', () => {
  test('calls save_outfit with the garment ids', async () => {
    const { client, rpc } = fakeClient();

    expect(await saveOutfit(['g-1', 'g-2', 'g-3'], client)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('save_outfit', { p_garment_ids: ['g-1', 'g-2', 'g-3'] });
  });

  test('a network error maps to the network RequestResult', async () => {
    const { client } = fakeClient({ data: null, error: { code: '', message: 'offline' }, status: 0 });

    expect(await saveOutfit(['g-1'], client)).toEqual({ ok: false, error: 'network' });
  });
});
