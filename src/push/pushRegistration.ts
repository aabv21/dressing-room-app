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
import { readPush, writePush } from './pushStore';

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
    const { error } = await client
      .from('push_tokens')
      .upsert(
        { token: registered, platform: Platform.OS === 'ios' ? 'ios' : 'android', review_ready: next.reviewReady, weekly: next.weekly },
        { onConflict: 'user_id,token' },
      );
    if (error !== null) return 'failed';
  } catch {
    return 'failed';
  }
  writePush(userId, { token: registered, ...next });
  // A reinstall or restore can hand the phone a new token; the old row would only collect dead pushes.
  if (previous !== null && previous !== registered) await deleteRow(client, previous).catch(() => false);
  return 'saved';
}

/** How long sign-out waits for the token delete on a stalled network. */
export const FORGET_TIMEOUT_MS = 5_000;

/**
 * Sign-out: deletes this phone's row while the session still can, and turns both off on the device.
 * Never throws; offline, the row stays until Expo reports the token gone or a newer account registers it.
 */
export async function forgetPushToken(userId: string, client: PushClient = supabase): Promise<void> {
  const stored = readPush(userId).token;
  if (stored === null) return;
  writePush(userId, { token: null, reviewReady: false, weekly: false });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
    }, FORGET_TIMEOUT_MS);
  });
  await Promise.race([deleteRow(client, stored).catch(() => false), stalled]);
  clearTimeout(timer);
}
