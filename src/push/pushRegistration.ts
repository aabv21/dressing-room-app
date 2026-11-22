// Opting in and out of the server's notices: the Expo push token and both choices in `push_tokens`
// (docs/app.md#notifications-from-the-app-srcpush).
import type { SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { PUSH_CHANNEL_ID } from '../../supabase/functions/_shared/push.ts';
import { translate, type Locale } from '../i18n';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { askReminderPermission } from '../reminder/dailyReminder';
import {
  deviceSecret,
  randomHex,
  readPendingClaim,
  readPendingUnregister,
  readPush,
  writePendingClaim,
  writePendingUnregister,
  writePush,
  type PendingClaim,
} from './pushStore';

export type PushClient = SupabaseClient<Database>;

export type PushPreferences = { reviewReady: boolean; weekly: boolean };

/**
 * `unavailable`: no token on this phone (no EAS project id, or FCM/APNs not set up for the build);
 * `verifying`: another account holds the token, so a claim is proving this phone receives it.
 */
export type PushOutcome = 'saved' | 'denied' | 'unavailable' | 'verifying' | 'failed';

function projectId(): string | null {
  const extra: unknown = Constants.expoConfig?.extra;
  const eas = typeof extra === 'object' && extra !== null ? (extra as { eas?: { projectId?: unknown } }).eas : undefined;
  return typeof eas?.projectId === 'string' && eas.projectId !== '' ? eas.projectId : null;
}

async function deviceToken(): Promise<string | null> {
  const id = projectId();
  if (id === null) return null;
  try {
    return (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
  } catch {
    return null;
  }
}

async function deleteRow(client: PushClient, token: string): Promise<boolean> {
  const { error } = await client.from('push_tokens').delete().eq('token', token);
  return error === null;
}

/** The token is this account's again: store the choices and take it off the unregister retries. */
function saved(userId: string, token: string, choices: PushPreferences): void {
  writePush(userId, { token, ...choices });
  writePendingUnregister(readPendingUnregister().filter((pending) => pending !== token));
}

/** Starts (or restarts) the claim with a fresh nonce, so a code from an earlier start no longer matches. */
async function startClaim(client: PushClient, claim: Omit<PendingClaim, 'nonce'>): Promise<void> {
  const nonce = randomHex(16);
  writePendingClaim({ ...claim, nonce });
  await client.functions.invoke('push-claim', { body: { token: claim.token, step: 'start', nonce } }).catch(() => undefined);
}

/** A session's end, or both notices off: a claim still in flight must not turn them back on later. */
function dropClaimOf(userId: string): void {
  if (readPendingClaim()?.userId === userId) writePendingClaim(null);
}

/** At launch or sign-in: asks again for this account's pending claim (the server allows one code per 10 minutes). */
export async function resumePushClaim(userId: string, client: PushClient = supabase): Promise<void> {
  const claim = readPendingClaim();
  if (claim === null) return;
  // Another account's claim can't be confirmed with this session.
  if (claim.userId !== userId) {
    writePendingClaim(null);
    return;
  }
  await startClaim(client, claim);
}

/**
 * A claim code push arrived: confirms this account's pending claim, only when the push carries that
 * claim's nonce (another account's claim on the token also pushes codes here, and confirming those
 * would spend this claim's attempts). True once the token is this phone's. Never throws.
 */
export async function confirmPushClaim(code: string, nonce: string, userId: string, client: PushClient = supabase): Promise<boolean> {
  const claim = readPendingClaim();
  if (claim?.userId !== userId || claim.nonce !== nonce) return false;
  const previous = readPush(userId).token;
  const ok = await within(() =>
    client.functions
      .invoke('push-claim', {
        body: {
          token: claim.token,
          step: 'confirm',
          code,
          nonce,
          device_secret: deviceSecret(),
          platform: claim.platform,
          review_ready: claim.reviewReady,
          weekly: claim.weekly,
        },
      })
      .then(({ error }) => error === null),
  );
  if (!ok) return false;
  writePendingClaim(null);
  saved(userId, claim.token, { reviewReady: claim.reviewReady, weekly: claim.weekly });
  await dropReplacedRow(client, previous, claim.token);
  return true;
}

/** A reinstall or restore can hand the phone a new token; the old row would only collect dead pushes. */
async function dropReplacedRow(client: PushClient, previous: string | null, current: string): Promise<void> {
  if (previous !== null && previous !== current) await deleteRow(client, previous).catch(() => false);
}

async function turnOff(userId: string, client: PushClient): Promise<PushOutcome> {
  dropClaimOf(userId);
  const stored = readPush(userId).token;
  if (stored !== null && !(await deleteRow(client, stored).catch(() => false))) return 'failed';
  writePush(userId, { token: null, reviewReady: false, weekly: false });
  return 'saved';
}

/** Saves both choices for this phone; both off deletes its row. Never throws. */
export async function setPushPreferences(
  userId: string,
  next: PushPreferences,
  language: Locale,
  client: PushClient = supabase,
): Promise<PushOutcome> {
  if (!next.reviewReady && !next.weekly) return turnOff(userId, client);
  try {
    // The channel first: Android 13 shows no permission prompt without one.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
        name: translate(language, 'push.channel'),
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    if (!(await askReminderPermission())) return 'denied';
  } catch {
    return 'failed';
  }
  const registered = await deviceToken();
  if (registered === null) return 'unavailable';
  const previous = readPush(userId).token;
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  try {
    const { error } = await client.rpc('register_push_token', {
      p_token: registered,
      p_platform: platform,
      p_review_ready: next.reviewReady,
      p_weekly: next.weekly,
      p_device_secret: deviceSecret(),
    });
    if (error !== null) {
      // 42501: another account holds the token under another secret (this phone lost its secret, or
      // someone learned the token). Prove receipt instead: the code arrives as a push.
      if (error.code === '42501') {
        await startClaim(client, { userId, token: registered, platform, ...next });
        return 'verifying';
      }
      return 'failed';
    }
  } catch {
    return 'failed';
  }
  saved(userId, registered, next);
  await dropReplacedRow(client, previous, registered);
  return 'saved';
}

/** How long sign-out and the flush wait for each call on a stalled network. */
export const FORGET_TIMEOUT_MS = 5_000;

/** `call`'s answer, or false once `FORGET_TIMEOUT_MS` passes or it fails. Never throws. */
async function within(call: () => PromiseLike<boolean>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
    }, FORGET_TIMEOUT_MS);
  });
  const done = await Promise.race([Promise.resolve().then(call).then(Boolean, () => false), stalled]);
  clearTimeout(timer);
  return done;
}

/**
 * Sign-out: deletes this phone's own row while the session still can, then turns both off on the
 * device. A row it couldn't delete leaves the token in the device's pending list. Never throws.
 */
export async function forgetPushToken(userId: string, client: PushClient = supabase): Promise<void> {
  dropClaimOf(userId);
  const stored = readPush(userId).token;
  if (stored === null) return;
  if (!(await within(() => deleteRow(client, stored)))) writePendingUnregister([...readPendingUnregister(), stored]);
  writePush(userId, { token: null, reviewReady: false, weekly: false });
}

/**
 * A session that ended without Sign out (another phone's global sign-out, a revoked session): with
 * no session to delete the row, the token joins the pending list for `push-unregister`, which pairs
 * it with this phone's secret, and the account's notices turn off here.
 */
export function forgetPushTokenLater(userId: string): void {
  dropClaimOf(userId);
  const stored = readPush(userId).token;
  if (stored === null) return;
  writePendingUnregister([...readPendingUnregister(), stored]);
  writePush(userId, { token: null, reviewReady: false, weekly: false });
}

/**
 * At launch and after a sign-in: `push-unregister` with each pending token and this phone's secret,
 * which deletes only rows this phone registered. Keeps each that fails again. Never throws.
 */
export async function flushPendingUnregister(client: PushClient = supabase): Promise<void> {
  const pending = readPendingUnregister();
  if (pending.length === 0) return;
  const secret = deviceSecret();
  const failed: string[] = [];
  for (const token of pending) {
    const ok = await within(() =>
      client.functions.invoke('push-unregister', { body: { token, device_secret: secret } }).then(({ error }) => error === null),
    );
    if (!ok) failed.push(token);
  }
  // A sign-out may have added a token meanwhile, or a registration taken one back.
  const now = readPendingUnregister();
  writePendingUnregister([...failed.filter((token) => now.includes(token)), ...now.filter((token) => !pending.includes(token))]);
}
