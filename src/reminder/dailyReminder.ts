// The daily outfit reminder: one repeating local notification per account, or one per weekday while
// a plan is coming, at the device's wall clock (docs/app.md#the-daily-reminder-srcreminder). No server.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { translate, type Locale } from '../i18n';
import { localDate } from '../lib/localDate';
import { kvUserRefused } from '../lib/kv';
import { readReminder, storedReminderIds, writeReminder, type ReminderSettings, type ReminderTime } from './reminderStore';

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
export async function askReminderPermission(): Promise<boolean> {
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

async function scheduledReminders(): Promise<Notifications.NotificationRequest[]> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    return scheduled.filter((entry) => entry.content.data?.kind === REMINDER_KIND);
  } catch {
    return [];
  }
}

async function scheduledReminderIds(): Promise<string[]> {
  return (await scheduledReminders()).map((entry) => entry.identifier);
}

// Each account's planned days and their pieces as text, in the app language; `DailyReminderSync` keeps
// it current, so every schedule (Profile's too) names the plans.
const plannedText = new Map<string, Readonly<Record<string, string>>>();

/** `YYYY-MM-DD` → the planned pieces ("Blouse · White, Jeans · Blue"). */
export function setReminderPlans(userId: string, plans: Readonly<Record<string, string>>): void {
  plannedText.set(userId, plans);
}

const REMINDER_WEEK = 7;

/** The next seven days the reminder fires on: from today while today's time is ahead, else tomorrow. */
function firingDays(time: ReminderTime, now: Date): Date[] {
  const first = new Date(now.getFullYear(), now.getMonth(), now.getDate(), time.hour, time.minute);
  if (first.getTime() <= now.getTime()) first.setDate(first.getDate() + 1);
  return Array.from({ length: REMINDER_WEEK }, (_, n) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + n, 12));
}

type ReminderNote = { body: string; weekday: number | null };

/**
 * One `DAILY` note with the usual text, or, when any of the next seven firings has a plan, one
 * `WEEKLY` note per weekday (1 is Sunday), the planned days naming their pieces.
 * NOTE: a weekly note keeps its plan text a week later if the app never opens; upgrade: a push from the server, if ever needed.
 */
function reminderNotes(userId: string, time: ReminderTime, language: Locale, now: Date): ReminderNote[] {
  const plans = plannedText.get(userId) ?? {};
  const generic = translate(language, 'reminder.note.body');
  const days = firingDays(time, now).map((day) => ({ day, pieces: plans[localDate(day)] }));
  if (days.every(({ pieces }) => pieces === undefined)) return [{ body: generic, weekday: null }];
  return days.map(({ day, pieces }) => ({
    body: pieces === undefined ? generic : translate(language, 'reminder.note.planned', { pieces }),
    weekday: day.getDay() + 1,
  }));
}

const noteKey = (weekday: unknown, body: unknown): string => JSON.stringify([weekday ?? null, body ?? null]);

/**
 * Whether the OS holds exactly the notes the settings and plans call for now: each note's weekday
 * (null for the daily one, from its `data`) with its text, order aside.
 */
export async function isReminderCurrent(userId: string, time: ReminderTime, language: Locale): Promise<boolean> {
  const held = (await scheduledReminders()).map((entry) => noteKey(entry.content.data?.weekday, entry.content.body)).sort();
  const wanted = reminderNotes(userId, time, language, new Date()).map((note) => noteKey(note.weekday, note.body)).sort();
  return JSON.stringify(held) === JSON.stringify(wanted);
}

/** The stored ids and every scheduled reminder, so one the kv lost track of (or the OS can't list) can't keep firing. */
async function cancelAllReminders(storedIds: readonly string[]): Promise<void> {
  const ids = new Set([...(await scheduledReminderIds()), ...storedIds]);
  for (const id of ids) await cancelQuietly(id);
}

/** The settings with no scheduled ids. */
function withoutIds(settings: ReminderSettings): ReminderSettings {
  return { enabled: settings.enabled, hour: settings.hour, minute: settings.minute, notificationId: null, language: settings.language };
}

async function scheduleNow(userId: string, time: ReminderTime, language: Locale): Promise<boolean> {
  // A deleted account (its kv refused) never gets a reminder back, whatever was queued before.
  if (kvUserRefused(userId)) return false;
  const previous = readReminder(userId);
  await cancelAllReminders(storedReminderIds(previous));
  try {
    await ensureReminderChannel(language);
    const ids: string[] = [];
    for (const note of reminderNotes(userId, time, language, new Date())) {
      const { hour, minute } = time;
      ids.push(
        await Notifications.scheduleNotificationAsync({
          content: {
            title: translate(language, 'reminder.note.title'),
            body: note.body,
            // The weekday lets `isReminderCurrent` tell a plan moved to another day.
            data: { kind: REMINDER_KIND, url: '/', weekday: note.weekday },
          },
          // DAILY and WEEKLY match the device's clock, so the reminder follows the local time zone.
          trigger:
            note.weekday === null
              ? { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute, channelId: REMINDER_CHANNEL_ID }
              : { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: note.weekday, hour, minute, channelId: REMINDER_CHANNEL_ID },
        }),
      );
    }
    const [first = null, ...others] = ids;
    writeReminder(userId, {
      enabled: true,
      hour: time.hour,
      minute: time.minute,
      notificationId: first,
      ...(others.length === 0 ? {} : { otherIds: others }),
      language,
    });
    return true;
  } catch {
    // Some weekly notes may already be scheduled: sweep them so a failure leaves none.
    await cancelAllReminders([]);
    writeReminder(userId, { ...withoutIds(previous), hour: time.hour, minute: time.minute, enabled: false });
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
    await cancelAllReminders(storedReminderIds(current));
    if (current.enabled || storedReminderIds(current).length > 0) {
      writeReminder(userId, { ...withoutIds(current), enabled: false });
    }
  });
}

/**
 * For the account deletion, which removes the kv key right after: reads the id now and cancels in
 * the queue, after any change already waiting, so nothing scheduled before it survives.
 */
export function forgetReminder(userId: string): Promise<void> {
  const ids = storedReminderIds(readReminder(userId));
  return serial(() => cancelAllReminders(ids));
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
