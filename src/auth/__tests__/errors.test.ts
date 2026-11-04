import { AuthError, AuthRetryableFetchError } from '@supabase/supabase-js';

import { toAuthErrorKey } from '../errors';

describe('toAuthErrorKey', () => {
  test.each([
    ['invalid_credentials', 'auth.error.invalidCredentials'],
    ['user_already_exists', 'auth.error.emailInUse'],
    ['email_exists', 'auth.error.emailInUse'],
    ['weak_password', 'auth.error.weakPassword'],
    ['otp_expired', 'auth.error.invalidCode'],
    ['invalid_otp', 'auth.error.invalidCode'],
    ['over_email_send_rate_limit', 'auth.error.rateLimited'],
    ['over_request_rate_limit', 'auth.error.rateLimited'],
  ] as const)('maps AuthError code %s to %s', (code, key) => {
    const error = new AuthError('boom', 400, code);
    expect(toAuthErrorKey(error)).toBe(key);
  });

  test('maps an unrecognized AuthError code to unknown', () => {
    const error = new AuthError('boom', 400, 'something_else');
    expect(toAuthErrorKey(error)).toBe('auth.error.unknown');
  });

  test('maps an AuthError with no code to unknown', () => {
    const error = new AuthError('boom', 500);
    expect(toAuthErrorKey(error)).toBe('auth.error.unknown');
  });

  test('maps AuthRetryableFetchError to network', () => {
    const error = new AuthRetryableFetchError('fetch failed', 0);
    expect(toAuthErrorKey(error)).toBe('auth.error.network');
  });

  test('maps a fetch TypeError to network', () => {
    const error = new TypeError('Network request failed');
    expect(toAuthErrorKey(error)).toBe('auth.error.network');
  });

  test('maps the native Apple cancel code to cancelled', () => {
    const error = Object.assign(new Error('cancelled'), { code: 'ERR_REQUEST_CANCELED' });
    expect(toAuthErrorKey(error)).toBe('auth.error.cancelled');
  });

  test('maps the native Google cancel code to cancelled', () => {
    const error = Object.assign(new Error('cancelled'), { code: 'SIGN_IN_CANCELLED' });
    expect(toAuthErrorKey(error)).toBe('auth.error.cancelled');
  });

  test('maps a plain Error to unknown', () => {
    expect(toAuthErrorKey(new Error('mystery'))).toBe('auth.error.unknown');
  });

  test('maps a non-error value to unknown', () => {
    expect(toAuthErrorKey('not an error')).toBe('auth.error.unknown');
    expect(toAuthErrorKey(undefined)).toBe('auth.error.unknown');
    expect(toAuthErrorKey(null)).toBe('auth.error.unknown');
  });
});
