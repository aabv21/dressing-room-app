import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';

import { supabase } from '../lib/supabase';
import { toAuthErrorKey } from './errors';
import { createNonce } from './nonce';
import type { Client, Result } from './emailAuth';

/**
 * Apple/Google sign-in. Kept out of `emailAuth.ts` because `expo-apple-authentication` and
 * `@react-native-google-signin/google-signin` depend on Expo/React Native's native module
 * registry and cannot be loaded under plain Node (only under jest-expo or a real app bundle) —
 * see `emailAuth.ts`'s module doc.
 */
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
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toAuthErrorKey(error) };
  }
}

let googleConfigured = false;

// `.env.example`'s placeholder values. A repo clone that copies `.env.example` to `.env.local`
// without editing it would otherwise "configure" Google sign-in with these literal strings instead
// of failing loudly — treat them the same as an unset variable.
const PLACEHOLDER_VALUES: ReadonlySet<string> = new Set([
  'replace-with-google-web-client-id',
  'replace-with-google-ios-client-id',
]);

/** True for a usable, real client id: not `undefined`, not blank, not one of `.env.example`'s placeholders. */
function isConfiguredClientId(value: string | undefined): value is string {
  if (value === undefined) {
    return false;
  }
  const trimmed = value.trim();
  return trimmed !== '' && !PLACEHOLDER_VALUES.has(trimmed);
}

/**
 * Configures `GoogleSignin` on first use only (configuring repeatedly is unnecessary and the
 * library doesn't expect it). Returns `false` without configuring when either public client ID is
 * missing, blank, or still the `.env.example` placeholder — this is a setup problem (the
 * integration session fills these in; see AGENTS.md), not a per-attempt user error, so it's logged
 * once via `console.warn` rather than silently retried every tap.
 *
 * Ruling (P2-R4): OAuth client IDs are not secrets — they identify the app to Google, the way a
 * bundle id does, and are meant to ship in the client. `EXPO_PUBLIC_*` inlines these at build time
 * (see Expo's docs and this repo's AGENTS.md); Expo's static analysis requires literal member
 * expressions wherever they're read, which is why they're read directly here rather than through a
 * helper that takes the key name as a variable.
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

/** Test-only: clears the "configured" flag so each test can exercise `ensureGoogleConfigured` fresh. */
export function resetGoogleConfiguredForTests(): void {
  googleConfigured = false;
}

/**
 * `@react-native-google-signin/google-signin` v17's free `signIn()` sends no nonce on Android, and
 * on iOS the native SDK injects its own hidden nonce that this library doesn't expose — so a
 * custom nonce here would mean the raw value this app generates never matches what's actually in
 * the ID token. GoTrue's OIDC verification (`token_oidc.go`) rejects the sign-in outright when
 * only one side carries a nonce or the hashes don't match, so passing one here made every Google
 * sign-in fail. Passing none is therefore correct for this library version, not a regression in
 * security: see the AGENTS.md NOTE on `skip_nonce_check` for what the integration session sets to
 * make the server-side match. NOTE: ceiling — Google sign-in on this app has no replay protection
 * from a custom nonce today. Upgrade path: a library version that exposes iOS's nonce, or Universal
 * Sign In (this package's paid tier), either of which would let a matching nonce be passed again.
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
