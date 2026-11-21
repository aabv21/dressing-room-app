jest.mock('../../lib/supabase', () => ({
  supabase: { auth: {} },
}));

import { deleteSavedTrip, listSavedTrips, SAVED_TRIPS_LIMIT, saveTrip } from '../savedTrips';
import type { TripResponse } from '../tripClient';

type Client = NonNullable<Parameters<typeof listSavedTrips>[0]>;

function fakeClient(rows: { data: unknown; error: unknown; status?: number }) {
  const settled = () => Promise.resolve({ status: 200, ...rows });
  const builder: Record<string, jest.Mock> = Object.assign(
    { then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => settled().then(resolve, reject) },
    Object.fromEntries(['select', 'order', 'limit', 'eq', 'delete', 'insert', 'single'].map((method) => [method, jest.fn(() => builder)])),
  );
  const from = jest.fn(() => builder);
  return { client: { from } as unknown as Client, from, builder };
}

const RESULT: TripResponse = { kind: 'ok', city: 'Lisboa', days: [], packing: [] };
const ROW = { id: 't-1', city: 'Lisboa', start_on: '2026-12-01', end_on: '2026-12-03', occasion: null, result: RESULT, created_at: '2026-11-21T10:00:00Z' };

test('lists the saved trips newest first, capped, dropping a snapshot this version can’t read', async () => {
  const { client, from, builder } = fakeClient({ data: [ROW, { ...ROW, id: 't-2', result: { kind: 'surprise' } }], error: null });

  const trips = await listSavedTrips(client);

  expect(from).toHaveBeenCalledWith('saved_trips');
  expect(builder['order']).toHaveBeenCalledWith('created_at', { ascending: false });
  expect(builder['limit']).toHaveBeenCalledWith(SAVED_TRIPS_LIMIT);
  expect(trips).toEqual([{ id: 't-1', city: 'Lisboa', start: '2026-12-01', end: '2026-12-03', occasion: null, result: RESULT }]);
});

test('saves the trip with its snapshot and answers the stored trip', async () => {
  const { client, builder } = fakeClient({ data: ROW, error: null });

  const saved = await saveTrip({ city: 'Lisboa', start: '2026-12-01', end: '2026-12-03', occasion: null, result: RESULT }, client);

  expect(builder['insert']).toHaveBeenCalledWith({ city: 'Lisboa', start_on: '2026-12-01', end_on: '2026-12-03', occasion: null, result: RESULT });
  expect(saved).toEqual({ ok: true, trip: { id: 't-1', city: 'Lisboa', start: '2026-12-01', end: '2026-12-03', occasion: null, result: RESULT } });
});

test('a failed save maps to network; a delete by id', async () => {
  const offline = fakeClient({ data: null, error: { code: '', message: 'offline' }, status: 0 });
  expect(await saveTrip({ city: 'Lisboa', start: '2026-12-01', end: '2026-12-03', occasion: null, result: RESULT }, offline.client)).toEqual({
    ok: false,
    error: 'network',
  });

  const { client, builder } = fakeClient({ data: null, error: null });
  expect(await deleteSavedTrip('t-1', client)).toEqual({ ok: true });
  expect(builder['eq']).toHaveBeenCalledWith('id', 't-1');
});
