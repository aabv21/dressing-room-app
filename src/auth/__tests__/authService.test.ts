import * as AppleAuthentication from 'expo-apple-authentication';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

import { AuthError, AuthRetryableFetchError } from '@supabase/supabase-js';

// A literal object, not an outer-scope variable: this project's Jest config runs in native ESM
// mode, where `jest.mock()` factories are not hoisted the way Babel's CJS jest-hoist plugin would
// (confirmed directly — a factory referencing an outer `const` here silently resolves `supabase`
// to `undefined`). Import `supabase` from '../../lib/supabase' below to get this same mocked object.
jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { signUp: jest.fn(() => Promise.resolve({ data: { session: { access_token: 'tok' } }, error: null })) },
  },
}));

jest.mock('../nonce', () => ({
  createNonce: jest.fn(() => Promise.resolve({ raw: 'raw-nonce', hashed: 'hashed-nonce' })),
}));

jest.mock('expo-apple-authentication', () => ({
  signInAsync: jest.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: { signIn: jest.fn(), configure: jest.fn() },
}));

import {
  confirmPasswordReset,
  requestPasswordReset,
  signInWithApple,
  signInWithEmail,
  signInWithGoogle,
  signOut,
  signUpWithEmail,
} from '../authService';
import type { Client } from '../authService';
import { resetGoogleConfiguredForTests } from '../socialAuth';
import { supabase as mockedDefaultClient } from '../../lib/supabase';

type FakeAuth = {
  signUp: jest.Mock;
  signInWithPassword: jest.Mock;
  signOut: jest.Mock;
  resetPasswordForEmail: jest.Mock;
  verifyOtp: jest.Mock;
  updateUser: jest.Mock;
  signInWithIdToken: jest.Mock;
};

/**
 * A minimal fake covering only the `auth` surface `authService` touches. Kept as a plain
 * `{ auth: FakeAuth }` (not cast to the real `SupabaseClient` type) so `jest.Mock` assertions like
 * `toHaveBeenCalledWith` stay plain function checks instead of tripping
 * `@typescript-eslint/unbound-method` on supabase-js's real (bound) method signatures; call sites
 * that need the `Client` shape cast narrowly at the call, not on this shared fake.
 */
function fakeClient(): { auth: FakeAuth } {
  return {
    auth: {
      signUp: jest.fn(() => Promise.resolve({ data: { session: { access_token: 'tok' } }, error: null })),
      signInWithPassword: jest.fn(() => Promise.resolve({ data: {}, error: null })),
      signOut: jest.fn(() => Promise.resolve({ error: null })),
      resetPasswordForEmail: jest.fn(() => Promise.resolve({ data: {}, error: null })),
      verifyOtp: jest.fn(() => Promise.resolve({ data: {}, error: null })),
      updateUser: jest.fn(() => Promise.resolve({ data: {}, error: null })),
      signInWithIdToken: jest.fn(() => Promise.resolve({ data: {}, error: null })),
    },
  };
}

function asClient(fake: { auth: FakeAuth }): Client {
  return fake as unknown as Client;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('signUpWithEmail', () => {
  test('forwards email and password and resolves ok with needsConfirmation false when a session comes back', async () => {
    const client = fakeClient();

    const result = await signUpWithEmail('new@example.com', 'hunter22', asClient(client));

    expect(client.auth.signUp).toHaveBeenCalledWith({ email: 'new@example.com', password: 'hunter22' });
    expect(result).toEqual({ ok: true, needsConfirmation: false });
  });

  test('resolves needsConfirmation true when sign-up returns no session (confirmations on)', async () => {
    const client = fakeClient();
    client.auth.signUp.mockResolvedValue({ data: { session: null }, error: null });

    const result = await signUpWithEmail('new@example.com', 'hunter22', asClient(client));

    expect(result).toEqual({ ok: true, needsConfirmation: true });
  });

  test('maps a signup error through toAuthErrorKey', async () => {
    const client = fakeClient();
    client.auth.signUp.mockResolvedValue({
      data: { session: null },
      error: new AuthError('already registered', 422, 'user_already_exists'),
    });

    const result = await signUpWithEmail('taken@example.com', 'hunter22', asClient(client));

    expect(result).toEqual({ ok: false, error: 'auth.error.emailInUse' });
  });

  test('falls back to the (mocked) lib/supabase client when none is passed', async () => {
    const result = await signUpWithEmail('default-client@example.com', 'hunter22');

    // eslint-disable-next-line @typescript-eslint/unbound-method -- a jest.fn() mock, not a real bound method
    expect(mockedDefaultClient.auth.signUp).toHaveBeenCalledWith({
      email: 'default-client@example.com',
      password: 'hunter22',
    });
    expect(result).toEqual({ ok: true, needsConfirmation: false });
  });
});

describe('signInWithEmail', () => {
  test('forwards email and password and resolves ok', async () => {
    const client = fakeClient();

    const result = await signInWithEmail('user@example.com', 'hunter22', asClient(client));

    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'hunter22',
    });
    expect(result).toEqual({ ok: true });
  });

  test('maps an invalid-credentials error', async () => {
    const client = fakeClient();
    client.auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: new AuthError('invalid', 400, 'invalid_credentials'),
    });

    const result = await signInWithEmail('user@example.com', 'wrong', asClient(client));

    expect(result).toEqual({ ok: false, error: 'auth.error.invalidCredentials' });
  });
});

describe('signOut', () => {
  test('calls signOut and resolves ok', async () => {
    const client = fakeClient();

    const result = await signOut(asClient(client));

    expect(client.auth.signOut).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true });
  });

  test('offline, falls back to a local sign-out so the device still signs out', async () => {
    const client = fakeClient();
    client.auth.signOut
      .mockResolvedValueOnce({ error: new AuthRetryableFetchError('fetch failed', 0) })
      .mockResolvedValueOnce({ error: null });

    const result = await signOut(asClient(client));

    expect(client.auth.signOut).toHaveBeenNthCalledWith(2, { scope: 'local' });
    expect(result).toEqual({ ok: true });
  });

  test('a thrown network error also falls back to the local sign-out', async () => {
    const client = fakeClient();
    client.auth.signOut.mockRejectedValueOnce(new TypeError('Network request failed')).mockResolvedValueOnce({ error: null });

    const result = await signOut(asClient(client));

    expect(client.auth.signOut).toHaveBeenNthCalledWith(2, { scope: 'local' });
    expect(result).toEqual({ ok: true });
  });

  test('surfaces the error when the local fallback fails too', async () => {
    const client = fakeClient();
    client.auth.signOut
      .mockResolvedValueOnce({ error: new AuthRetryableFetchError('fetch failed', 0) })
      .mockResolvedValueOnce({ error: new AuthError('storage failed', 500, 'unexpected_failure') });

    const result = await signOut(asClient(client));

    expect(result).toEqual({ ok: false, error: 'auth.error.unknown' });
  });

  test('surfaces a non-network failure without retrying', async () => {
    const client = fakeClient();
    client.auth.signOut.mockResolvedValueOnce({ error: new AuthError('rate limited', 429, 'over_request_rate_limit') });

    const result = await signOut(asClient(client));

    expect(client.auth.signOut).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: false, error: 'auth.error.rateLimited' });
  });
});

describe('requestPasswordReset', () => {
  test('forwards the email and resolves ok', async () => {
    const client = fakeClient();

    const result = await requestPasswordReset('user@example.com', asClient(client));

    expect(client.auth.resetPasswordForEmail).toHaveBeenCalledWith('user@example.com');
    expect(result).toEqual({ ok: true });
  });

  test('resolves ok even when the email has no account, so the response never reveals that', async () => {
    const client = fakeClient();
    client.auth.resetPasswordForEmail.mockResolvedValue({
      data: {},
      error: new AuthError('user not found', 400, 'user_not_found'),
    });

    const result = await requestPasswordReset('unknown@example.com', asClient(client));

    expect(result).toEqual({ ok: true });
  });

  test('resolves ok on an email rate limit: a code was already sent', async () => {
    const client = fakeClient();
    client.auth.resetPasswordForEmail.mockResolvedValue({
      data: {},
      error: new AuthError('slow down', 429, 'over_email_send_rate_limit'),
    });

    const result = await requestPasswordReset('user@example.com', asClient(client));

    expect(result).toEqual({ ok: true });
  });

  test('still surfaces a real failure, e.g. a request rate limit', async () => {
    const client = fakeClient();
    client.auth.resetPasswordForEmail.mockResolvedValue({
      data: {},
      error: new AuthError('slow down', 429, 'over_request_rate_limit'),
    });

    const result = await requestPasswordReset('user@example.com', asClient(client));

    expect(result).toEqual({ ok: false, error: 'auth.error.rateLimited' });
  });
});

describe('confirmPasswordReset', () => {
  test('verifies the recovery code then updates the password', async () => {
    const client = fakeClient();

    const result = await confirmPasswordReset('user@example.com', '123456', 'newPassword1', asClient(client));

    expect(client.auth.verifyOtp).toHaveBeenCalledWith({
      email: 'user@example.com',
      token: '123456',
      type: 'recovery',
    });
    expect(client.auth.updateUser).toHaveBeenCalledWith({ password: 'newPassword1' });
    expect(result).toEqual({ ok: true });
  });

  test('never calls updateUser when verifyOtp fails', async () => {
    const client = fakeClient();
    client.auth.verifyOtp.mockResolvedValue({
      data: {},
      error: new AuthError('expired', 400, 'otp_expired'),
    });

    const result = await confirmPasswordReset('user@example.com', '000000', 'newPassword1', asClient(client));

    expect(client.auth.updateUser).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: 'auth.error.invalidCode' });
  });

  test('maps an updateUser failure after a successful verify', async () => {
    const client = fakeClient();
    client.auth.updateUser.mockResolvedValue({
      data: {},
      error: new AuthError('too weak', 422, 'weak_password'),
    });

    const result = await confirmPasswordReset('user@example.com', '123456', 'weak', asClient(client));

    expect(result).toEqual({ ok: false, error: 'auth.error.weakPassword' });
  });

  test('signs out locally when updateUser fails after a successful verify', async () => {
    const client = fakeClient();
    client.auth.updateUser.mockResolvedValue({
      data: {},
      error: new AuthError('too weak', 422, 'weak_password'),
    });

    await confirmPasswordReset('user@example.com', '123456', 'weak', asClient(client));

    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  test('does not sign out when verifyOtp itself fails (no recovery session was ever established)', async () => {
    const client = fakeClient();
    client.auth.verifyOtp.mockResolvedValue({
      data: {},
      error: new AuthError('expired', 400, 'otp_expired'),
    });

    await confirmPasswordReset('user@example.com', '000000', 'newPassword1', asClient(client));

    expect(client.auth.signOut).not.toHaveBeenCalled();
  });
});

describe('signInWithApple', () => {
  test('uses the hashed nonce with Apple and the raw nonce with signInWithIdToken', async () => {
    const client = fakeClient();
    (AppleAuthentication.signInAsync as jest.Mock).mockResolvedValue({
      identityToken: 'apple-id-token',
      user: 'apple-user',
      email: 'apple@example.com',
      fullName: null,
      state: null,
      realUserStatus: 0,
      authorizationCode: null,
    });

    const result = await signInWithApple(asClient(client));

    expect(AppleAuthentication.signInAsync).toHaveBeenCalledWith({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: 'hashed-nonce',
    });
    expect(client.auth.signInWithIdToken).toHaveBeenCalledWith({
      provider: 'apple',
      token: 'apple-id-token',
      nonce: 'raw-nonce',
    });
    expect(result).toEqual({ ok: true });
  });

  test('maps the cancel code to cancelled', async () => {
    const client = fakeClient();
    (AppleAuthentication.signInAsync as jest.Mock).mockRejectedValue(
      Object.assign(new Error('cancelled'), { code: 'ERR_REQUEST_CANCELED' }),
    );

    const result = await signInWithApple(asClient(client));

    expect(client.auth.signInWithIdToken).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: 'auth.error.cancelled' });
  });
});

describe('signInWithGoogle', () => {
  // Mutates `process.env` in place (not `process.env = {...}`) because Expo's babel preset
  // rewrites `process.env.EXPO_PUBLIC_*` reads in non-production builds to go through
  // `expo/virtual/env`'s `export const env = process.env` — a reference captured once. Reassigning
  // `process.env` to a new object would leave that reference pointing at the old one, so these
  // tests' env changes would never be visible to `socialAuth.ts`.
  beforeEach(() => {
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'web-client-id';
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = 'ios-client-id';
    resetGoogleConfiguredForTests();
  });

  afterEach(() => {
    delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    delete process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  });

  function mockSuccess(): void {
    (GoogleSignin.signIn as jest.Mock).mockResolvedValue({
      type: 'success',
      data: {
        idToken: 'google-id-token',
        user: { id: '1', email: 'g@example.com', name: null, photo: null, familyName: null, givenName: null },
        scopes: [],
        serverAuthCode: null,
      },
    });
  }

  test('forwards the Google id token to signInWithIdToken with no nonce', async () => {
    const client = fakeClient();
    mockSuccess();

    const result = await signInWithGoogle(asClient(client));

    expect(client.auth.signInWithIdToken).toHaveBeenCalledWith({
      provider: 'google',
      token: 'google-id-token',
    });
    const [[call]] = client.auth.signInWithIdToken.mock.calls as [[Record<string, unknown>]];
    expect(call).not.toHaveProperty('nonce');
    expect(result).toEqual({ ok: true });
  });

  test('maps a cancelled Google sign-in to cancelled without calling signInWithIdToken', async () => {
    const client = fakeClient();
    (GoogleSignin.signIn as jest.Mock).mockResolvedValue({ type: 'cancelled', data: null });

    const result = await signInWithGoogle(asClient(client));

    expect(client.auth.signInWithIdToken).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: 'auth.error.cancelled' });
  });

  test('configures GoogleSignin with the public client IDs exactly once across calls', async () => {
    const client = fakeClient();
    mockSuccess();

    await signInWithGoogle(asClient(client));
    await signInWithGoogle(asClient(client));

    expect(GoogleSignin.configure).toHaveBeenCalledTimes(1);
    expect(GoogleSignin.configure).toHaveBeenCalledWith({
      webClientId: 'web-client-id',
      iosClientId: 'ios-client-id',
    });
  });

  test('resolves auth.error.unknown and warns when the web client id is missing', async () => {
    delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    const client = fakeClient();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await signInWithGoogle(asClient(client));

    expect(result).toEqual({ ok: false, error: 'auth.error.unknown' });
    expect(GoogleSignin.signIn).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('resolves auth.error.unknown and warns when the iOS client id is missing', async () => {
    delete process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
    const client = fakeClient();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await signInWithGoogle(asClient(client));

    expect(result).toEqual({ ok: false, error: 'auth.error.unknown' });
    expect(GoogleSignin.signIn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('treats an empty or whitespace-only client id as missing', async () => {
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = '   ';
    const client = fakeClient();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await signInWithGoogle(asClient(client));

    expect(result).toEqual({ ok: false, error: 'auth.error.unknown' });
    expect(GoogleSignin.signIn).not.toHaveBeenCalled();
    expect(GoogleSignin.configure).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('treats the .env.example placeholder values as missing', async () => {
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'replace-with-google-web-client-id';
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = 'replace-with-google-ios-client-id';
    const client = fakeClient();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await signInWithGoogle(asClient(client));

    expect(result).toEqual({ ok: false, error: 'auth.error.unknown' });
    expect(GoogleSignin.signIn).not.toHaveBeenCalled();
    expect(GoogleSignin.configure).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
