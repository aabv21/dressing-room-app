// integration/profile.int.test.ts
//
// profileRepository against the running local stack: completeOnboarding is stamped by the server
// clock (the profiles_stamp_onboarding_completed_at trigger), not by whatever the client sends,
// and the Profile tab's language override round-trips as 'en' | 'es' | null.

import { signInWithEmail } from '../src/auth/emailAuth';
import { completeOnboarding, getProfile, saveProfile } from '../src/profile/profileRepository';
import { anonClient, createUser, deleteUser, loadIntegrationEnv, uniqueEmail } from './helpers';

loadIntegrationEnv();

const PASSWORD = 'Password123!';
// Generous: Docker's clock and this machine's are the same host clock, so drift is ~0; this only
// absorbs request latency.
const CLOCK_TOLERANCE_MS = 60_000;

let userId: string;
let client: ReturnType<typeof anonClient>;

beforeAll(async () => {
  const email = uniqueEmail('profile-user');
  userId = await createUser(email, PASSWORD);
  client = anonClient();
  expect(await signInWithEmail(email, PASSWORD, client)).toEqual({ ok: true });
});

afterAll(async () => {
  await deleteUser(userId);
});

test('a client-sent completion time is replaced by the server clock, and completeOnboarding keeps it', async () => {
  expect(await saveProfile(userId, { clothing_type: 'feminine' }, client)).toEqual({ ok: true });

  // Bypass completeOnboarding and send a wildly wrong device time straight through PostgREST.
  const { error } = await client
    .from('profiles')
    .update({ onboarding_completed_at: '1999-01-01T00:00:00Z' })
    .eq('user_id', userId);
  expect(error).toBeNull();

  const stamped = (await getProfile(userId, client))?.onboarding_completed_at ?? null;
  expect(stamped).not.toBeNull();
  expect(Math.abs(Date.parse(stamped ?? '') - Date.now())).toBeLessThan(CLOCK_TOLERANCE_MS);

  expect(await completeOnboarding(userId, client)).toEqual({ ok: true });
  expect((await getProfile(userId, client))?.onboarding_completed_at).toBe(stamped);
});

test('completeOnboarding stamps the server time on a fresh profile', async () => {
  const email = uniqueEmail('profile-fresh');
  const freshId = await createUser(email, PASSWORD);
  try {
    const freshClient = anonClient();
    expect(await signInWithEmail(email, PASSWORD, freshClient)).toEqual({ ok: true });
    expect(await saveProfile(freshId, { clothing_type: 'masculine' }, freshClient)).toEqual({ ok: true });

    expect(await completeOnboarding(freshId, freshClient)).toEqual({ ok: true });

    const stamped = (await getProfile(freshId, freshClient))?.onboarding_completed_at ?? null;
    expect(stamped).not.toBeNull();
    expect(Math.abs(Date.parse(stamped ?? '') - Date.now())).toBeLessThan(CLOCK_TOLERANCE_MS);
  } finally {
    await deleteUser(freshId);
  }
});

test.each(['en', 'es', null] as const)('saves the language override %p', async (language) => {
  expect(await saveProfile(userId, { language }, client)).toEqual({ ok: true });
  expect((await getProfile(userId, client))?.language).toBe(language);
});
