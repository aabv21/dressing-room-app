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
import { deviceSecret, readPendingUnregister, readPush, writePendingUnregister, writePush } from './pushStore';

export type PushClient = SupabaseClient<Database>;

export type PushPreferences = { reviewReady: boolean; weekly: boolean };

/** `unavailable`: no token on this phone (no EAS project id, or FCM/APNs not set up for the build). */
export type PushOutcome = 'saved' | 'denied' | 'unavailable' | 'failed';

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

async function turnOff(userId: string, client: PushClient): Promise<PushOutcome> {
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
  try {
    // The server refuses (42501) a token another device registered: its secret differs.
    const { error } = await client.rpc('register_push_token', {
      p_token: registered,
      p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
      p_review_ready: next.reviewReady,
      p_weekly: next.weekly,
      p_device_secret: deviceSecret(),
    });
    if (error !== null) return 'failed';
  } catch {
    return 'failed';
  }
  writePush(userId, { token: registered, ...next });
  // This account holds the token again, so an earlier sign-out's retry must not delete it.
  writePendingUnregister(readPendingUnregister().filter((token) => token !== registered));
  // A reinstall or restore can hand the phone a new token; the old row would only collect dead pushes.
  if (previous !== null && previous !== registered) await deleteRow(client, previous).catch(() => false);
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
  const stored = readPush(userId).token;
  if (stored === null) return;
  if (!(await within(() => deleteRow(client, stored)))) writePendingUnregister([...readPendingUnregister(), stored]);
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
