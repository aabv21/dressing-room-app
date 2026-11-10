jest.mock('../../lib/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() }, auth: { getUser: jest.fn(), getSession: jest.fn() } },
}));

import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  FunctionsFetchError,
  FunctionsHttpError,
} from '@supabase/supabase-js';

import { deleteAccount, exportData, exportFileName, verifyAccount } from '../accountClient';
import type { DataExport } from '../accountClient';

type InvokeResult = { data: unknown; error: unknown };
type GetUserResult = { data: { user: unknown }; error: unknown };
type GetSessionResult = { data: { session: { access_token: string; user: { id: string } } | null }; error: unknown };

const TOKEN = 'access-token-1';

/** A fake Supabase client with only the `functions.invoke` and `auth` surface the client uses. */
function fakeClient(
  invoke: () => Promise<InvokeResult>,
  getUser: () => Promise<GetUserResult> = signedIn,
  getSession: () => Promise<GetSessionResult> = withSession,
) {
  const client = {
    functions: { invoke: jest.fn(invoke) },
    auth: { getUser: jest.fn(getUser), getSession: jest.fn(getSession) },
  };
  return {
    client: client as unknown as Parameters<typeof deleteAccount>[0],
    invoke: client.functions.invoke,
    getUser: client.auth.getUser,
  };
}

function signedIn(): Promise<GetUserResult> {
  return Promise.resolve({ data: { user: { id: 'user-1' } }, error: null });
}

function withSession(): Promise<GetSessionResult> {
  return Promise.resolve({ data: { session: { access_token: TOKEN, user: { id: 'user-1' } } }, error: null });
}

function httpError(status: number): FunctionsHttpError {
  return new FunctionsHttpError(new Response(null, { status }));
}

function unauthorized(): Promise<InvokeResult> {
  return Promise.resolve({ data: null, error: httpError(401) });
}

describe('deleteAccount', () => {
  test("the function's 200 `deleted` answer is a deletion, asked with the session's token", async () => {
    const { client, invoke, getUser } = fakeClient(() => Promise.resolve({ data: { outcome: 'deleted' }, error: null }));

    expect(await deleteAccount(client)).toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith('delete-account', { body: {}, headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(getUser).not.toHaveBeenCalled();
  });

  test('a 200 with any other body is not taken as a deletion', async () => {
    const { client } = fakeClient(() => Promise.resolve({ data: { outcome: 'maybe' }, error: null }));

    expect(await deleteAccount(client)).toEqual({ ok: false, error: 'unknown' });
  });

  test('a 500 keeps the account (the server says the user is still there)', async () => {
    const { client, getUser } = fakeClient(() => Promise.resolve({ data: null, error: httpError(500) }));

    expect(await deleteAccount(client)).toEqual({ ok: false, error: 'unknown' });
    expect(getUser).not.toHaveBeenCalled();
  });

  test('a network failure is reported as network', async () => {
    const { client } = fakeClient(() =>
      Promise.resolve({ data: null, error: new FunctionsFetchError(new TypeError('Network request failed')) }),
    );

    expect(await deleteAccount(client)).toEqual({ ok: false, error: 'network' });
  });

  test('a thrown invoke is reported, not thrown', async () => {
    const { client } = fakeClient(() => Promise.reject(new TypeError('Network request failed')));

    expect(await deleteAccount(client)).toEqual({ ok: false, error: 'network' });
  });

  test('no session on the device asks to sign in again, without calling the function', async () => {
    const { client, invoke } = fakeClient(unauthorized, signedIn, () =>
      Promise.resolve({ data: { session: null }, error: new AuthSessionMissingError() }),
    );

    expect(await deleteAccount(client)).toEqual({ ok: false, error: 'reauth' });
    expect(invoke).not.toHaveBeenCalled();
  });

  test('a session that cannot be refreshed for lack of network is a network failure', async () => {
    const { client, invoke } = fakeClient(unauthorized, signedIn, () =>
      Promise.resolve({ data: { session: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) }),
    );

    expect(await deleteAccount(client)).toEqual({ ok: false, error: 'network' });
    expect(invoke).not.toHaveBeenCalled();
  });

  describe('a 401', () => {
    test('is a deletion when Auth answers user_not_found for the same token', async () => {
      const { client, getUser } = fakeClient(unauthorized, () =>
        Promise.resolve({
          data: { user: null },
          error: new AuthApiError('User from sub claim in JWT does not exist', 403, 'user_not_found'),
        }),
      );

      expect(await deleteAccount(client)).toEqual({ ok: true });
      expect(getUser).toHaveBeenCalledWith(TOKEN);
    });

    test.each([
      ['session_not_found', new AuthApiError('Session not found', 403, 'session_not_found')],
      ['refresh_token_not_found', new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found')],
      ['a missing session', new AuthSessionMissingError()],
      ['an expired token', new AuthApiError('invalid JWT: token is expired', 403, 'bad_jwt')],
      ['any other Auth error', new AuthApiError('boom', 500, 'unexpected_failure')],
    ])('asks to sign in again, never reports deleted, on %s', async (_label, error) => {
      const { client } = fakeClient(unauthorized, () => Promise.resolve({ data: { user: null }, error }));

      expect(await deleteAccount(client)).toEqual({ ok: false, error: 'reauth' });
    });

    test('asks to sign in again when Auth still knows the user', async () => {
      const { client } = fakeClient(unauthorized);

      expect(await deleteAccount(client)).toEqual({ ok: false, error: 'reauth' });
    });

    test('is a network failure when Auth cannot be reached', async () => {
      const { client } = fakeClient(unauthorized, () =>
        Promise.resolve({ data: { user: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) }),
      );

      expect(await deleteAccount(client)).toEqual({ ok: false, error: 'network' });
    });
  });
});

describe('verifyAccount (the launch check after an unconfirmed deletion)', () => {
  const noInvoke = (): Promise<InvokeResult> => Promise.reject(new Error('verifyAccount must never call a function'));

  test('is gone when Auth answers user_not_found to the session token, and calls no function', async () => {
    const { client, invoke, getUser } = fakeClient(noInvoke, () =>
      Promise.resolve({ data: { user: null }, error: new AuthApiError('gone', 403, 'user_not_found') }),
    );

    expect(await verifyAccount('user-1', client)).toBe('gone');
    expect(getUser).toHaveBeenCalledWith(TOKEN);
    expect(invoke).not.toHaveBeenCalled();
  });

  test('exists when Auth returns this same user', async () => {
    const { client, invoke } = fakeClient(noInvoke);

    expect(await verifyAccount('user-1', client)).toBe('exists');
    expect(invoke).not.toHaveBeenCalled();
  });

  test.each([
    ['Auth returns another user', () => Promise.resolve({ data: { user: { id: 'user-2' } }, error: null })],
    ['Auth cannot be reached', () => Promise.resolve({ data: { user: null }, error: new AuthRetryableFetchError('x', 0) })],
    ['the token expired', () => Promise.resolve({ data: { user: null }, error: new AuthApiError('expired', 403, 'bad_jwt') })],
    ['the session is gone', () => Promise.resolve({ data: { user: null }, error: new AuthApiError('s', 403, 'session_not_found') })],
  ] satisfies [string, () => Promise<GetUserResult>][])('is unknown when %s', async (_label, getUser) => {
    const { client } = fakeClient(noInvoke, getUser);

    expect(await verifyAccount('user-1', client)).toBe('unknown');
  });

  test("is unknown without a session, or with another user's session", async () => {
    const none = fakeClient(noInvoke, signedIn, () => Promise.resolve({ data: { session: null }, error: null }));
    const other = fakeClient(noInvoke, signedIn, () =>
      Promise.resolve({ data: { session: { access_token: TOKEN, user: { id: 'user-2' } } }, error: null }),
    );

    expect(await verifyAccount('user-1', none.client)).toBe('unknown');
    expect(await verifyAccount('user-1', other.client)).toBe('unknown');
    expect(none.getUser).not.toHaveBeenCalled();
  });
});

describe('exportData', () => {
  const EXPORT: DataExport = {
    exportedAt: '2026-11-09T12:00:00.000Z',
    profile: { user_id: 'user-1' },
    garments: [],
    outfits: [],
    wears: [],
    photos: [],
  };

  test("returns the function's document", async () => {
    const { client, invoke } = fakeClient(() => Promise.resolve({ data: EXPORT, error: null }));

    expect(await exportData(client)).toEqual({ ok: true, result: EXPORT });
    expect(invoke).toHaveBeenCalledWith('export-data', { body: {} });
  });

  test.each([
    ['an HTTP error', { data: null, error: httpError(500) }, 'unknown'],
    ['a network error', { data: null, error: new FunctionsFetchError(new TypeError('x')) }, 'network'],
    ['an empty body', { data: null, error: null }, 'unknown'],
  ] as const)('%s is a failure', async (_label, answer, expected) => {
    const { client } = fakeClient(() => Promise.resolve(answer));

    expect(await exportData(client)).toEqual({ ok: false, error: expected });
  });
});

describe('exportFileName', () => {
  test("names the file after the device's local day", () => {
    expect(exportFileName(new Date(2026, 0, 5, 23, 59))).toBe('dressing-room-export-2026-01-05.json');
  });
});
