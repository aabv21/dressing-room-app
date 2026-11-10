// The account privacy client: thin wrappers over the `delete-account` and `export-data` functions
// (see their `handler.ts`) that map failures to a small error union the screen translates.

import {
  FunctionsFetchError,
  FunctionsHttpError,
  isAuthApiError,
  isAuthRetryableFetchError,
  type SupabaseClient,
} from '@supabase/supabase-js';

import type { DataExport } from '../../supabase/functions/export-data/handler.ts';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { localDate } from '../outfits/aiClient';

export type { DataExport };

type Client = SupabaseClient<Database>;

export type AccountError = 'network' | 'unknown';

export type AccountFailure = { ok: false; error: AccountError };

/**
 * `deleteAccount`'s failures: `reauth` means this device's session can't make or confirm the
 * deletion (no session, or a 401 Auth doesn't explain as a deleted user), so the user must sign in
 * again and retry, which then gets a definite answer.
 */
export type DeleteFailure = { ok: false; error: AccountError | 'reauth' };

function errorFrom(error: unknown): AccountError {
  if (error instanceof FunctionsFetchError || error instanceof TypeError || isAuthRetryableFetchError(error)) {
    return 'network';
  }
  return 'unknown';
}

function statusOf(error: unknown): number | undefined {
  return error instanceof FunctionsHttpError && error.context instanceof Response ? error.context.status : undefined;
}

type SessionToken = { access_token: string; user: { id: string } };

/**
 * What Auth says about this very token (`GET /auth/v1/user`, no refresh): `gone` only for
 * `user_not_found`, `exists` for the session's own user, `network` when Auth can't be reached, and
 * `other` for anything else (an expired token, a revoked session, another user).
 */
async function tokenUser(client: Client, session: SessionToken): Promise<'gone' | 'exists' | 'network' | 'other'> {
  const { data, error } = await client.auth.getUser(session.access_token);
  if (error === null) {
    return data.user.id === session.user.id ? 'exists' : 'other';
  }
  if (isAuthApiError(error) && error.code === 'user_not_found') return 'gone';
  return isAuthRetryableFetchError(error) ? 'network' : 'other';
}

/**
 * Deletes the signed-in account. `ok` only when the function answers `{ outcome: 'deleted' }`, or
 * when it answers 401 and Auth says `user_not_found` for the very token that was sent (a retry
 * after a lost 200, while that token is still unexpired). The token is read once and sent
 * explicitly, so the 401 and the Auth check are about the same token. Every other 401, and a
 * device with no session, is `reauth`: a revoked session or refresh token doesn't mean the account
 * is gone. Never throws.
 */
export async function deleteAccount(client: Client = supabase): Promise<{ ok: true } | DeleteFailure> {
  try {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError !== null && isAuthRetryableFetchError(sessionError)) {
      return { ok: false, error: 'network' };
    }
    const { session } = sessionData;
    if (session === null) {
      return { ok: false, error: 'reauth' };
    }
    const response = await client.functions.invoke<unknown>('delete-account', {
      body: {},
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (response.error === null) {
      const { data } = response;
      const deleted = typeof data === 'object' && data !== null && 'outcome' in data && data.outcome === 'deleted';
      return deleted ? { ok: true } : { ok: false, error: 'unknown' };
    }
    if (statusOf(response.error) !== 401) {
      return { ok: false, error: errorFrom(response.error) };
    }
    const status = await tokenUser(client, session);
    if (status === 'gone') {
      return { ok: true };
    }
    return { ok: false, error: status === 'network' ? 'network' : 'reauth' };
  } catch (error) {
    return { ok: false, error: errorFrom(error) };
  }
}

/**
 * Checks, without deleting anything, whether `userId`'s account still exists, for a deletion whose
 * answer never arrived: `gone` when Auth answers `user_not_found` to this session's token, `exists`
 * when it returns this same user, `unknown` for anything else (no session, another user's session,
 * Auth unreachable, an expired token). Never throws.
 */
export async function verifyAccount(userId: string, client: Client = supabase): Promise<'gone' | 'exists' | 'unknown'> {
  try {
    const { data } = await client.auth.getSession();
    const { session } = data;
    if (session === null || session.user.id !== userId) {
      return 'unknown';
    }
    const status = await tokenUser(client, session);
    return status === 'gone' || status === 'exists' ? status : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** The signed-in account's data as one JSON document (signed photo URLs valid for 7 days). */
export async function exportData(client: Client = supabase): Promise<{ ok: true; result: DataExport } | AccountFailure> {
  try {
    const response = await client.functions.invoke<DataExport>('export-data', { body: {} });
    if (response.error !== null || response.data === null) {
      return { ok: false, error: response.error !== null ? errorFrom(response.error) : 'unknown' };
    }
    return { ok: true, result: response.data };
  } catch (error) {
    return { ok: false, error: errorFrom(error) };
  }
}

/** `dressing-room-export-YYYY-MM-DD.json`, named after the device's local day. */
export function exportFileName(now: Date = new Date()): string {
  return `dressing-room-export-${localDate(now)}.json`;
}
