// The account privacy client: thin wrappers over the `delete-account` and `export-data` functions
// (see their `handler.ts`) that map failures to a small error union the screen translates.

import {
  FunctionsFetchError,
  FunctionsHttpError,
  isAuthApiError,
  isAuthRetryableFetchError,
  type SupabaseClient,
} from '@supabase/supabase-js';

import { isRecord } from '../../supabase/functions/_shared/guards.ts';
import type { DataExport } from '../../supabase/functions/export-data/handler.ts';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { localDate } from '../lib/localDate';

export type { DataExport };

type Client = SupabaseClient<Database>;

export type AccountError = 'network' | 'unknown';

export type AccountFailure = { ok: false; error: AccountError };

/**
 * `reauth`: this session can't make or confirm the deletion (no session, or a 401 Auth doesn't explain
 * as a deleted user), so the user signs in again and retries for a definite answer.
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
 * Which answers count as deleted: docs/app.md#account-deletion-on-the-device. The token is read once
 * and sent explicitly, so a 401 and the Auth check are about the same token. Never throws.
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
 * Verify only, for a deletion whose answer never arrived: `gone` on `user_not_found`, `exists` for this
 * same user, `unknown` otherwise (no session, another user, Auth unreachable, an expired token). Never throws.
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

const isRows = (value: unknown): boolean => Array.isArray(value) && value.every(isRecord);

function isPhoto(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.garmentId === 'string' &&
    (value.full === null || typeof value.full === 'string') &&
    (value.thumb === null || typeof value.thumb === 'string')
  );
}

/** The export document's shape; anything else (a newer function's answer) is never written to a file. */
function isDataExport(value: unknown): value is DataExport {
  return (
    isRecord(value) &&
    typeof value.exportedAt === 'string' &&
    (value.profile === null || isRecord(value.profile)) &&
    isRows(value.garments) &&
    isRows(value.outfits) &&
    isRows(value.wears) &&
    isRows(value.dismissedOutfits) &&
    Array.isArray(value.photos) &&
    value.photos.every(isPhoto)
  );
}

/** The signed-in account's data as one JSON document (signed photo URLs valid for 7 days). */
export async function exportData(client: Client = supabase): Promise<{ ok: true; result: DataExport } | AccountFailure> {
  try {
    const response = await client.functions.invoke<unknown>('export-data', { body: {} });
    if (response.error !== null) return { ok: false, error: errorFrom(response.error) };
    return isDataExport(response.data) ? { ok: true, result: response.data } : { ok: false, error: 'unknown' };
  } catch (error) {
    return { ok: false, error: errorFrom(error) };
  }
}

/** `dressing-room-export-YYYY-MM-DD.json`, named after the device's local day. */
export function exportFileName(now: Date = new Date()): string {
  return `dressing-room-export-${localDate(now)}.json`;
}
