// integration/auth.int.test.ts
//
// Exercises authService against a locally running Supabase stack (see helpers.ts for the
// `.env.local` + client setup, and AGENTS.md's "Local backend" section for the `db:*` scripts).
// Run with `pnpm db:start && pnpm db:reset && pnpm env:local && pnpm test:int`.

import {
  confirmPasswordReset,
  requestPasswordReset,
  signInWithEmail,
  signOut,
  signUpWithEmail,
} from '../src/auth/emailAuth';
import { anonClient, createUser, deleteUser, latestEmailCode, loadIntegrationEnv, uniqueEmail } from './helpers';

loadIntegrationEnv();

const createdUserIds: string[] = [];

afterAll(async () => {
  await Promise.all(createdUserIds.map((id) => deleteUser(id)));
});

test('sign up, sign out, then sign in works', async () => {
  const email = uniqueEmail('signup-flow');
  const client = anonClient();

  const signUpResult = await signUpWithEmail(email, 'Password123!', client);
  expect(signUpResult).toEqual({ ok: true });

  const { data: signedUpUser } = await client.auth.getUser();
  if (signedUpUser.user !== null) {
    createdUserIds.push(signedUpUser.user.id);
  }

  const signOutResult = await signOut(client);
  expect(signOutResult).toEqual({ ok: true });

  const signInResult = await signInWithEmail(email, 'Password123!', client);
  expect(signInResult).toEqual({ ok: true });

  const { data } = await client.auth.getUser();
  expect(data.user?.email).toBe(email);
});

test('signing up an existing email gives emailInUse', async () => {
  const email = uniqueEmail('duplicate-signup');
  const userId = await createUser(email, 'Password123!');
  createdUserIds.push(userId);

  const result = await signUpWithEmail(email, 'AnotherPassword1!', anonClient());

  expect(result).toEqual({ ok: false, error: 'auth.error.emailInUse' });
});

test('a wrong password gives invalidCredentials', async () => {
  const email = uniqueEmail('wrong-password');
  const userId = await createUser(email, 'Password123!');
  createdUserIds.push(userId);

  const result = await signInWithEmail(email, 'TotallyWrongPassword!', anonClient());

  expect(result).toEqual({ ok: false, error: 'auth.error.invalidCredentials' });
});

describe('password reset', () => {
  test('request -> code -> confirm with a new password; old password stops working', async () => {
    const email = uniqueEmail('reset-flow');
    const userId = await createUser(email, 'OldPassword123!');
    createdUserIds.push(userId);

    const requestResult = await requestPasswordReset(email, anonClient());
    expect(requestResult).toEqual({ ok: true });

    const code = await latestEmailCode(email);

    const confirmResult = await confirmPasswordReset(email, code, 'NewPassword456!', anonClient());
    expect(confirmResult).toEqual({ ok: true });

    const newPasswordSignIn = await signInWithEmail(email, 'NewPassword456!', anonClient());
    expect(newPasswordSignIn).toEqual({ ok: true });

    const oldPasswordSignIn = await signInWithEmail(email, 'OldPassword123!', anonClient());
    expect(oldPasswordSignIn).toEqual({ ok: false, error: 'auth.error.invalidCredentials' });
  });

  test('a wrong code gives invalidCode and leaves the password unchanged', async () => {
    const email = uniqueEmail('reset-wrong-code');
    const userId = await createUser(email, 'OriginalPassword1!');
    createdUserIds.push(userId);

    await requestPasswordReset(email, anonClient());
    const realCode = await latestEmailCode(email);
    const wrongCode = realCode === '000000' ? '111111' : '000000';
    expect(wrongCode).not.toBe(realCode);

    const result = await confirmPasswordReset(email, wrongCode, 'ShouldNotApply1!', anonClient());

    expect(result).toEqual({ ok: false, error: 'auth.error.invalidCode' });

    const signInWithOriginal = await signInWithEmail(email, 'OriginalPassword1!', anonClient());
    expect(signInWithOriginal).toEqual({ ok: true });
  });

  test('reusing an already-used code gives invalidCode and the password stays the one set by the first use', async () => {
    const email = uniqueEmail('reset-reuse-code');
    const userId = await createUser(email, 'FirstPassword1!');
    createdUserIds.push(userId);

    await requestPasswordReset(email, anonClient());
    const code = await latestEmailCode(email);

    const firstUse = await confirmPasswordReset(email, code, 'SecondPassword2!', anonClient());
    expect(firstUse).toEqual({ ok: true });

    const secondUse = await confirmPasswordReset(email, code, 'ThirdPassword3!', anonClient());
    expect(secondUse).toEqual({ ok: false, error: 'auth.error.invalidCode' });

    const signInWithFirstUsePassword = await signInWithEmail(email, 'SecondPassword2!', anonClient());
    expect(signInWithFirstUsePassword).toEqual({ ok: true });
  });
});
