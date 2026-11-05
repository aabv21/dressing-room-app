jest.mock('../../lib/supabase', () => ({
  supabase: { auth: {} },
}));

import { completeOnboarding, getProfile, saveProfile } from '../profileRepository';

function fakeClient(result: { data: unknown; error: unknown }) {
  const maybeSingle = jest.fn(() => Promise.resolve(result));
  const eq = jest.fn(() => ({ maybeSingle }));
  const select = jest.fn(() => ({ eq }));
  const from = jest.fn(() => ({ select }));
  return {
    client: { from } as unknown as Parameters<typeof getProfile>[1],
    from,
    select,
    eq,
    maybeSingle,
  };
}

test('queries the profiles table by user_id and returns the row', async () => {
  const row = { user_id: 'user-1', onboarding_completed_at: null };
  const { client, from, select, eq } = fakeClient({ data: row, error: null });

  const profile = await getProfile('user-1', client);

  expect(from).toHaveBeenCalledWith('profiles');
  expect(select).toHaveBeenCalledWith('*');
  expect(eq).toHaveBeenCalledWith('user_id', 'user-1');
  expect(profile).toEqual(row);
});

test('returns null when no row matches', async () => {
  const { client } = fakeClient({ data: null, error: null });

  const profile = await getProfile('missing-user', client);

  expect(profile).toBeNull();
});

test('throws when the query errors', async () => {
  const { client } = fakeClient({ data: null, error: new Error('boom') });

  await expect(getProfile('user-1', client)).rejects.toThrow('boom');
});

describe('saveProfile', () => {
  function upsertClient(result: { error: unknown; status?: number }) {
    const upsert = jest.fn(() => Promise.resolve({ data: null, error: result.error, status: result.status ?? 201 }));
    const from = jest.fn(() => ({ upsert }));
    return { client: { from } as unknown as Parameters<typeof saveProfile>[2], from, upsert };
  }

  test('upserts the patch on user_id', async () => {
    const { client, from, upsert } = upsertClient({ error: null });

    const result = await saveProfile('user-1', { clothing_type: 'masculine' }, client);

    expect(result).toEqual({ ok: true });
    expect(from).toHaveBeenCalledWith('profiles');
    expect(upsert).toHaveBeenCalledWith({ user_id: 'user-1', clothing_type: 'masculine' }, { onConflict: 'user_id' });
  });

  test('never writes onboarding_completed_at = null (binding item a)', async () => {
    const { client, upsert } = upsertClient({ error: null });

    await saveProfile('user-1', { height_cm: 170, onboarding_completed_at: null }, client);

    expect(upsert).toHaveBeenCalledWith({ user_id: 'user-1', height_cm: 170 }, { onConflict: 'user_id' });
  });

  test('a fetch failure (status 0) maps to profile.error.network', async () => {
    const { client } = upsertClient({
      error: { message: 'TypeError: Network request failed', details: '', hint: '', code: '' },
      status: 0,
    });

    expect(await saveProfile('user-1', { height_cm: 170 }, client)).toEqual({ ok: false, error: 'profile.error.network' });
  });

  test('a thrown TypeError maps to profile.error.network', async () => {
    const upsert = jest.fn(() => Promise.reject(new TypeError('Network request failed')));
    const client = { from: jest.fn(() => ({ upsert })) } as unknown as Parameters<typeof saveProfile>[2];

    expect(await saveProfile('user-1', { height_cm: 170 }, client)).toEqual({ ok: false, error: 'profile.error.network' });
  });

  test.each(['23514', '22P02', '22003', '23502'])('Postgres code %s maps to profile.error.invalid', async (code) => {
    const { client } = upsertClient({ error: { message: 'bad', details: '', hint: '', code }, status: 400 });

    expect(await saveProfile('user-1', { height_cm: 300 }, client)).toEqual({ ok: false, error: 'profile.error.invalid' });
  });

  test('anything else maps to profile.error.unknown', async () => {
    const { client } = upsertClient({ error: { message: 'denied', details: '', hint: '', code: '42501' }, status: 403 });

    expect(await saveProfile('user-1', { height_cm: 170 }, client)).toEqual({ ok: false, error: 'profile.error.unknown' });
  });
});

describe('completeOnboarding', () => {
  function updateClient(result: { error: unknown; status?: number }) {
    const is = jest.fn(() => Promise.resolve({ data: null, error: result.error, status: result.status ?? 204 }));
    const eq = jest.fn(() => ({ is }));
    const update = jest.fn(() => ({ eq }));
    const from = jest.fn(() => ({ update }));
    return { client: { from } as unknown as Parameters<typeof completeOnboarding>[1], from, update, eq, is };
  }

  test('stamps onboarding_completed_at with the current time, only if it is still unset', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-05T12:00:00.000Z') });
    const { client, from, update, eq, is } = updateClient({ error: null });

    const result = await completeOnboarding('user-1', client);

    expect(result).toEqual({ ok: true });
    expect(from).toHaveBeenCalledWith('profiles');
    expect(update).toHaveBeenCalledWith({ onboarding_completed_at: '2026-11-05T12:00:00.000Z' });
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(is).toHaveBeenCalledWith('onboarding_completed_at', null);
    jest.useRealTimers();
  });

  test('maps a network failure', async () => {
    const { client } = updateClient({ error: { message: 'FetchError: offline', details: '', hint: '', code: '' }, status: 0 });

    expect(await completeOnboarding('user-1', client)).toEqual({ ok: false, error: 'profile.error.network' });
  });
});
