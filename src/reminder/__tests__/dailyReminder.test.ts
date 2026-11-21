import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { allowUserKeys, kvGet, kvKeys, kvRemove } from '../../lib/kv';
import {
  cancelStoredReminder,
  isReminderResponse,
  REMINDER_CHANNEL_ID,
  scheduleReminder,
  turnOffReminder,
  turnOnReminder,
} from '../dailyReminder';
import { DEFAULT_REMINDER, readReminder, reminderKey } from '../reminderStore';

const USER = 'user-1';
const mocked = jest.mocked(Notifications);

function denied(canAskAgain: boolean): Notifications.NotificationPermissionsStatus {
  return { granted: false, canAskAgain, status: 'denied', expires: 'never' } as unknown as Notifications.NotificationPermissionsStatus;
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of kvKeys()) kvRemove(key);
  allowUserKeys(USER);
  mocked.scheduleNotificationAsync.mockReset().mockResolvedValue('reminder-1');
});

test('the default is off at 07:30', () => {
  expect(readReminder(USER)).toEqual(DEFAULT_REMINDER);
  expect(DEFAULT_REMINDER).toMatchObject({ enabled: false, hour: 7, minute: 30 });
});

test('turning it on schedules one daily notification at the local time, in the language, and stores its id', async () => {
  await expect(turnOnReminder(USER, { hour: 7, minute: 30 }, 'en')).resolves.toBe('on');

  expect(mocked.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(mocked.scheduleNotificationAsync).toHaveBeenCalledWith({
    content: {
      title: 'Your outfit for today is ready',
      body: 'Open Today to see what to wear.',
      data: { kind: 'dailyReminder', url: '/' },
    },
    trigger: { type: 'daily', hour: 7, minute: 30, channelId: REMINDER_CHANNEL_ID },
  });
  expect(readReminder(USER)).toEqual({ enabled: true, hour: 7, minute: 30, notificationId: 'reminder-1', language: 'en' });
  expect(kvGet(reminderKey(USER))).not.toBeNull();
});

test('the Spanish copy', async () => {
  await turnOnReminder(USER, { hour: 6, minute: 45 }, 'es');

  expect(mocked.scheduleNotificationAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      content: expect.objectContaining({ title: 'Tu outfit de hoy está listo', body: 'Abre Hoy para ver qué ponerte.' }) as unknown,
    }),
  );
});

test('on Android the channel exists before the permission is asked (Android 13 shows no prompt without one)', async () => {
  const original = Platform.OS;
  Platform.OS = 'android';
  try {
    mocked.getPermissionsAsync.mockResolvedValueOnce(denied(true));
    await turnOnReminder(USER, { hour: 7, minute: 30 }, 'en');

    expect(mocked.setNotificationChannelAsync).toHaveBeenCalledWith(REMINDER_CHANNEL_ID, {
      name: 'Daily outfit reminder',
      importance: 5,
    });
    const channelOrder = mocked.setNotificationChannelAsync.mock.invocationCallOrder[0] ?? Infinity;
    const requestOrder = mocked.requestPermissionsAsync.mock.invocationCallOrder[0] ?? -Infinity;
    expect(channelOrder).toBeLessThan(requestOrder);
  } finally {
    Platform.OS = original;
  }
});

test('an iOS provisional authorization counts as allowed', async () => {
  mocked.getPermissionsAsync.mockResolvedValueOnce({
    ...denied(true),
    ios: { status: 3 },
  } as unknown as Notifications.NotificationPermissionsStatus);

  await expect(turnOnReminder(USER, { hour: 7, minute: 30 }, 'en')).resolves.toBe('on');
  expect(mocked.requestPermissionsAsync).not.toHaveBeenCalled();
});

test('denied asks when it still can, then schedules nothing and stores nothing', async () => {
  mocked.getPermissionsAsync.mockResolvedValueOnce(denied(true));
  mocked.requestPermissionsAsync.mockResolvedValueOnce(denied(false));

  await expect(turnOnReminder(USER, { hour: 7, minute: 30 }, 'en')).resolves.toBe('denied');

  expect(mocked.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(mocked.scheduleNotificationAsync).not.toHaveBeenCalled();
  expect(readReminder(USER).enabled).toBe(false);
});

test("a permanent denial doesn't ask again", async () => {
  mocked.getPermissionsAsync.mockResolvedValueOnce(denied(false));

  await expect(turnOnReminder(USER, { hour: 7, minute: 30 }, 'en')).resolves.toBe('denied');
  expect(mocked.requestPermissionsAsync).not.toHaveBeenCalled();
});

test('a scheduling failure answers failed and leaves it off', async () => {
  mocked.scheduleNotificationAsync.mockRejectedValueOnce(new Error('native'));

  await expect(turnOnReminder(USER, { hour: 7, minute: 30 }, 'en')).resolves.toBe('failed');
  expect(readReminder(USER)).toMatchObject({ enabled: false, notificationId: null });
});

test('re-scheduling cancels the previous notification first, then keeps only the new id', async () => {
  await turnOnReminder(USER, { hour: 7, minute: 30 }, 'en');
  mocked.scheduleNotificationAsync.mockResolvedValueOnce('reminder-2');

  await expect(scheduleReminder(USER, { hour: 8, minute: 15 }, 'en')).resolves.toBe(true);

  expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledWith('reminder-1');
  const cancelOrder = mocked.cancelScheduledNotificationAsync.mock.invocationCallOrder[0] ?? Infinity;
  const scheduleOrder = mocked.scheduleNotificationAsync.mock.invocationCallOrder[1] ?? -Infinity;
  expect(cancelOrder).toBeLessThan(scheduleOrder);
  expect(readReminder(USER)).toMatchObject({ enabled: true, hour: 8, minute: 15, notificationId: 'reminder-2' });
});

test('two re-schedules in a row never leave two notifications', async () => {
  await turnOnReminder(USER, { hour: 7, minute: 30 }, 'en');
  mocked.scheduleNotificationAsync.mockResolvedValueOnce('reminder-2').mockResolvedValueOnce('reminder-3');

  await Promise.all([scheduleReminder(USER, { hour: 8, minute: 0 }, 'en'), scheduleReminder(USER, { hour: 9, minute: 0 }, 'es')]);

  expect(mocked.cancelScheduledNotificationAsync.mock.calls).toEqual([['reminder-1'], ['reminder-2']]);
  expect(readReminder(USER)).toMatchObject({ hour: 9, notificationId: 'reminder-3', language: 'es' });
});

test('turning it off cancels the notification and keeps the chosen time', async () => {
  await turnOnReminder(USER, { hour: 6, minute: 5 }, 'en');

  await turnOffReminder(USER);

  expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledWith('reminder-1');
  expect(readReminder(USER)).toEqual({ enabled: false, hour: 6, minute: 5, notificationId: null, language: 'en' });
});

test('turning off a reminder that was never on cancels nothing', async () => {
  await turnOffReminder(USER);
  expect(mocked.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
});

test('cancelStoredReminder cancels the stored id without waiting (the account deletion)', async () => {
  await turnOnReminder(USER, { hour: 7, minute: 30 }, 'en');

  cancelStoredReminder(USER);

  expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledWith('reminder-1');
});

test("isReminderResponse: a tap on the reminder, not another notification's or an action button", () => {
  function response(data: Record<string, unknown>, actionIdentifier = Notifications.DEFAULT_ACTION_IDENTIFIER) {
    return { actionIdentifier, notification: { request: { content: { data } } } } as unknown as Notifications.NotificationResponse;
  }
  expect(isReminderResponse(response({ kind: 'dailyReminder', url: '/' }))).toBe(true);
  expect(isReminderResponse(response({ kind: 'other' }))).toBe(false);
  expect(isReminderResponse(response({ kind: 'dailyReminder' }, 'snooze'))).toBe(false);
});
