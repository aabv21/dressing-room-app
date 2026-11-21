// The daily outfit reminder: one repeating local notification per account, at the device's wall
// clock (docs/app.md#the-daily-reminder-srcreminder). No server, no push token.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { translate, type Locale } from '../i18n';
import { readReminder, writeReminder, type ReminderTime } from './reminderStore';

export const REMINDER_CHANNEL_ID = 'daily-reminder';
const REMINDER_KIND = 'dailyReminder';

export type ReminderOutcome = 'on' | 'denied' | 'failed';

// Every change runs after the previous one, so two quick changes can't both read the same old id
// and leave two notifications scheduled.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

async function ensureReminderChannel(language: Locale): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: translate(language, 'reminder.channel'),
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

function allowed(status: Notifications.NotificationPermissionsStatus): boolean {
  return status.granted || status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

/** Asks only when the system still can; a permanent denial is left to Settings. */
async function askReminderPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (allowed(current)) return true;
  if (!current.canAskAgain) return false;
  const answer = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
  return allowed(answer);
}

async function cancelQuietly(id: string | null): Promise<void> {
  if (id === null) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // Already delivered or gone: nothing left to cancel.
  }
}

async function scheduleNow(userId: string, time: ReminderTime, language: Locale): Promise<boolean> {
  const previous = readReminder(userId);
  await cancelQuietly(previous.notificationId);
  try {
    await ensureReminderChannel(language);
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: translate(language, 'reminder.note.title'),
        body: translate(language, 'reminder.note.body'),
        data: { kind: REMINDER_KIND, url: '/' },
      },
      // DAILY matches the device's hour and minute, so the reminder follows the local time zone.
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: time.hour, minute: time.minute, channelId: REMINDER_CHANNEL_ID },
    });
    writeReminder(userId, { enabled: true, hour: time.hour, minute: time.minute, notificationId, language });
    return true;
  } catch {
    writeReminder(userId, { ...previous, hour: time.hour, minute: time.minute, enabled: false, notificationId: null });
    return false;
  }
}

/** Schedules (or re-schedules) the reminder, cancelling the stored one first. */
export function scheduleReminder(userId: string, time: ReminderTime, language: Locale): Promise<boolean> {
  return serial(() => scheduleNow(userId, time, language));
}

/** The switch: the channel first (Android 13 shows no prompt without one), then the permission. */
export function turnOnReminder(userId: string, time: ReminderTime, language: Locale): Promise<ReminderOutcome> {
  return serial(async () => {
    try {
      await ensureReminderChannel(language);
      if (!(await askReminderPermission())) return 'denied';
    } catch {
      return 'failed';
    }
    return (await scheduleNow(userId, time, language)) ? 'on' : 'failed';
  });
}

/** Off, or a session that ended: cancels the notification and keeps the chosen time. */
export function turnOffReminder(userId: string): Promise<void> {
  return serial(async () => {
    const current = readReminder(userId);
    await cancelQuietly(current.notificationId);
    if (current.enabled || current.notificationId !== null) {
      writeReminder(userId, { ...current, enabled: false, notificationId: null });
    }
  });
}

/** For the account deletion, which removes the kv key right after: reads the id now, cancels in the background. */
export function cancelStoredReminder(userId: string): void {
  const { notificationId } = readReminder(userId);
  void cancelQuietly(notificationId);
}

/** A tap on the reminder itself (not an action button, not another notification). */
export function isReminderResponse(response: Notifications.NotificationResponse): boolean {
  return (
    response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER &&
    response.notification.request.content.data?.kind === REMINDER_KIND
  );
}

/** With the app open the reminder still shows, silently. */
export function presentRemindersInForeground(): void {
  Notifications.setNotificationHandler({
    handleNotification: () =>
      Promise.resolve({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}
