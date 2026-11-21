import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';

import { supabase } from '../lib/supabase';
import { toAuthErrorKey } from './errors';
import { createNonce } from './nonce';
import type { Client, Result } from './emailAuth';

/** Kept out of `emailAuth.ts`: the Apple and Google SDKs need React Native's native modules, not plain Node. */
export async function signInWithApple(client: Client = supabase): Promise<Result> {
  try {
    const { raw, hashed } = await createNonce();
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashed,
    });
    if (credential.identityToken === null) {
      return { ok: false, error: 'auth.error.unknown' };
    }

    const { error } = await client.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
      nonce: raw,
    });
    if (error !== null) {
      return { ok: false, error: toAuthErrorKey(error) };
    }
    if (credential.authorizationCode !== null) {
      sendAppleAuthorizationCode(client, credential.authorizationCode);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toAuthErrorKey(error) };
  }
}

/** The `apple-token` function's outcome words (`supabase/functions/apple-token/handler.ts`). */
const APPLE_TOKEN_OUTCOME = /^[a-z_]{1,32}$/;

function logAppleTokenOutcome(outcome: string): void {
  if (__DEV__) {
    console.info(`apple-token: ${outcome}`);
  }
}

/**
 * `apple-token` exchanges the one-time code for the refresh token account deletion revokes
 * (`signInWithIdToken` keeps none). Fire-and-forget; only the outcome word is logged (dev), never the code.
 */
function sendAppleAuthorizationCode(client: Client, code: string): void {
  try {
    client.functions
      .invoke<{ outcome?: unknown }>('apple-token', { body: { code } })
      .then(
        ({ data, error }) => {
          const outcome = error === null && typeof data?.outcome === 'string' ? data.outcome : 'failed';
          logAppleTokenOutcome(APPLE_TOKEN_OUTCOME.test(outcome) ? outcome : 'failed');
        },
        () => {
          logAppleTokenOutcome('failed');
        },
      )
      // A throw inside the logging itself must not surface as an unhandled rejection.
      .catch(() => undefined);
  } catch {
    logAppleTokenOutcome('failed');
  }
}

let googleConfigured = false;

// `.env.example`'s placeholders count as unset, so an unedited copy fails loudly instead of "configuring".
const PLACEHOLDER_VALUES: ReadonlySet<string> = new Set([
  'replace-with-google-web-client-id',
  'replace-with-google-ios-client-id',
]);

function isConfiguredClientId(value: string | undefined): value is string {
  if (value === undefined) {
    return false;
  }
  const trimmed = value.trim();
  return trimmed !== '' && !PLACEHOLDER_VALUES.has(trimmed);
}

/**
 * Configures once, on first use; a missing id is a setup problem, warned in dev, not a user error.
 * OAuth client ids aren't secrets. `EXPO_PUBLIC_*` is inlined at build time only for literal member
 * expressions, so they're read directly rather than through a helper taking the key name.
 */
function ensureGoogleConfigured(): boolean {
  if (googleConfigured) {
    return true;
  }
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  if (!isConfiguredClientId(webClientId) || !isConfiguredClientId(iosClientId)) {
    if (__DEV__) {
      console.warn(
        'Sign in with Google is not configured: set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID and EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID.',
      );
    }
    return false;
  }
  GoogleSignin.configure({ webClientId, iosClientId });
  googleConfigured = true;
  return true;
}

/**
 * No nonce: the library can't send a matching one, so GoTrue would reject every sign-in (docs/red-team.md#parked).
 * NOTE: no nonce replay protection for Google; upgrade: a library version exposing iOS's nonce, or Universal Sign In.
 */
export async function signInWithGoogle(client: Client = supabase): Promise<Result> {
  try {
    if (!ensureGoogleConfigured()) {
      return { ok: false, error: 'auth.error.unknown' };
    }

    const response = await GoogleSignin.signIn();
    if (response.type === 'cancelled') {
      return { ok: false, error: 'auth.error.cancelled' };
    }
    const idToken = response.data.idToken;
    if (idToken === null) {
      return { ok: false, error: 'auth.error.unknown' };
    }

    const { error } = await client.auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
    });
    if (error !== null) {
      return { ok: false, error: toAuthErrorKey(error) };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toAuthErrorKey(error) };
  }
}
