jest.mock('../../lib/supabase', () => ({
  supabase: { auth: {} },
}));

import { getProfile } from '../profileRepository';

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
