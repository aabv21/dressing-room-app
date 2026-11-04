import { isAuthError, isAuthRetryableFetchError } from '@supabase/supabase-js';

export type AuthErrorKey =
  | 'auth.error.invalidCredentials'
  | 'auth.error.emailInUse'
  | 'auth.error.weakPassword'
  | 'auth.error.invalidCode'
  | 'auth.error.rateLimited'
  | 'auth.error.network'
  | 'auth.error.cancelled'
  | 'auth.error.unknown';

const CODE_TO_KEY: Readonly<Record<string, AuthErrorKey>> = {
  invalid_credentials: 'auth.error.invalidCredentials',
  user_already_exists: 'auth.error.emailInUse',
  email_exists: 'auth.error.emailInUse',
  weak_password: 'auth.error.weakPassword',
  otp_expired: 'auth.error.invalidCode',
  invalid_otp: 'auth.error.invalidCode',
  over_email_send_rate_limit: 'auth.error.rateLimited',
  over_request_rate_limit: 'auth.error.rateLimited',
};

/** The native-module codes surfaced when a user cancels an Apple or Google sign-in sheet. */
const CANCEL_CODES: ReadonlySet<string> = new Set(['ERR_REQUEST_CANCELED', 'SIGN_IN_CANCELLED']);

function hasStringCode(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string';
}

/**
 * Maps any error `authService` might throw or receive from supabase-js, Apple or Google sign-in
 * to a translated-message key, so screens never show a raw provider error to the user.
 */
export function toAuthErrorKey(error: unknown): AuthErrorKey {
  if (isAuthRetryableFetchError(error) || error instanceof TypeError) {
    return 'auth.error.network';
  }
  if (hasStringCode(error) && CANCEL_CODES.has(error.code)) {
    return 'auth.error.cancelled';
  }
  if (isAuthError(error) && error.code !== undefined) {
    return CODE_TO_KEY[error.code] ?? 'auth.error.unknown';
  }
  return 'auth.error.unknown';
}
