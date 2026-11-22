jest.mock('../../lib/supabase', () => ({
  supabase: { auth: {} },
}));

import { listPlans, planOutfit, removePlan } from '../plannedOutfits';

type Client = NonNullable<Parameters<typeof listPlans>[2]>;

function fakeClient(rows: { data: unknown; error: unknown; status?: number }) {
  const settled = () => Promise.resolve({ status: 200, ...rows });
  const builder: Record<string, jest.Mock> = Object.assign(
    { then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => settled().then(resolve, reject) },
    Object.fromEntries(['select', 'gte', 'lte', 'order', 'eq', 'delete'].map((method) => [method, jest.fn(() => builder)])),
  );
  const from = jest.fn(() => builder);
  const rpc = jest.fn(() => settled());
  return { client: { from, rpc } as unknown as Client, from, rpc, builder };
}

describe('listPlans', () => {
  test('reads the caller’s plans from today to the window’s last day, by day', async () => {
    const { client, from, builder } = fakeClient({
      data: [{ id: 'p-1', planned_on: '2026-11-22', garment_ids: ['g-1', 'g-2'], occasion: 'office' }],
      error: null,
    });

    const plans = await listPlans('2026-11-21', '2026-12-04', client);

    expect(from).toHaveBeenCalledWith('planned_outfits');
    expect(builder['select']).toHaveBeenCalledWith('id, planned_on, garment_ids, occasion');
    expect(builder['gte']).toHaveBeenCalledWith('planned_on', '2026-11-21');
    expect(builder['lte']).toHaveBeenCalledWith('planned_on', '2026-12-04');
    expect(builder['order']).toHaveBeenCalledWith('planned_on', { ascending: true });
    expect(plans).toEqual([{ id: 'p-1', day: '2026-11-22', garmentIds: ['g-1', 'g-2'], occasion: 'office' }]);
  });

  test('throws on a failed read', async () => {
    const { client } = fakeClient({ data: null, error: { code: '', message: 'offline' }, status: 0 });
    await expect(listPlans('2026-11-21', '2026-12-04', client)).rejects.toBeTruthy();
  });
});

describe('planOutfit', () => {
  test('calls plan_outfit with the day, the garments and the occasion, and answers the plan', async () => {
    const { client, rpc } = fakeClient({ data: 'p-9', error: null });

    const result = await planOutfit({ day: '2026-11-24', garmentIds: ['g-1', 'g-2', 'g-3'], occasion: 'going_out' }, client);

    expect(rpc).toHaveBeenCalledWith('plan_outfit', {
      p_planned_on: '2026-11-24',
      p_garment_ids: ['g-1', 'g-2', 'g-3'],
      p_occasion: 'going_out',
    });
    expect(result).toEqual({ ok: true, plan: { id: 'p-9', day: '2026-11-24', garmentIds: ['g-1', 'g-2', 'g-3'], occasion: 'going_out' } });
  });

  test('no occasion leaves the argument out', async () => {
    const { client, rpc } = fakeClient({ data: 'p-9', error: null });
    await planOutfit({ day: '2026-11-24', garmentIds: ['g-1', 'g-2'], occasion: null }, client);
    expect(rpc).toHaveBeenCalledWith('plan_outfit', { p_planned_on: '2026-11-24', p_garment_ids: ['g-1', 'g-2'] });
  });

  test('its own refusals (a foreign garment, a day out of the window) are invalid; offline is network', async () => {
    const refused = fakeClient({ data: null, error: { code: '42501', message: 'plan_outfit: one or more garments' }, status: 403 });
    expect(await planOutfit({ day: '2026-11-24', garmentIds: ['g-1', 'g-2'], occasion: null }, refused.client)).toEqual({
      ok: false,
      error: 'invalid',
    });
    const offline = fakeClient({ data: null, error: { code: '', message: 'offline' }, status: 0 });
    expect(await planOutfit({ day: '2026-11-24', garmentIds: ['g-1', 'g-2'], occasion: null }, offline.client)).toEqual({
      ok: false,
      error: 'network',
    });
  });
});

describe('removePlan', () => {
  test('deletes the plan by id', async () => {
    const { client, from, builder } = fakeClient({ data: [{ id: 'p-1' }], error: null });

    expect(await removePlan('p-1', client)).toEqual({ ok: true });
    expect(from).toHaveBeenCalledWith('planned_outfits');
    expect(builder['delete']).toHaveBeenCalled();
    expect(builder['eq']).toHaveBeenCalledWith('id', 'p-1');
  });

  test('a plan already gone counts as removed', async () => {
    const { client } = fakeClient({ data: [], error: null });
    expect(await removePlan('p-1', client)).toEqual({ ok: true });
  });
});
