import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { forgetAccountOnDevice } from '../../account/forgetAccount';
import { allowUserKeys, kvGet, kvKeys, kvRemove } from '../../lib/kv';
import {
  forgetReminder,
  isReminderCurrent,
  isReminderResponse,
  REMINDER_CHANNEL_ID,
  scheduleReminder,
  setReminderPlans,
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
  setReminderPlans(USER, {});
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
      data: { kind: 'dailyReminder', url: '/', weekday: null },
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

test('forgetReminder cancels the stored id (the account deletion)', async () => {
  await turnOnReminder(USER, { hour: 7, minute: 30 }, 'en');

  await forgetReminder(USER);

  expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledWith('reminder-1');
});

describe('against the scheduled notifications themselves, not only the stored id', () => {
  // A stand-in for the OS's scheduled list: schedule adds, cancel removes, getAll lists.
  let scheduled: Notifications.NotificationRequest[] = [];
  let nextId = 0;

  function request(identifier: string, kind: string): Notifications.NotificationRequest {
    return { identifier, content: { data: { kind } }, trigger: null } as unknown as Notifications.NotificationRequest;
  }

  beforeEach(() => {
    scheduled = [];
    nextId = 0;
    mocked.scheduleNotificationAsync.mockReset().mockImplementation((input) => {
      nextId += 1;
      const identifier = `scheduled-${String(nextId)}`;
      const kind = (input.content.data as { kind?: string } | undefined)?.kind ?? '';
      scheduled.push(request(identifier, kind));
      return Promise.resolve(identifier);
    });
    mocked.cancelScheduledNotificationAsync.mockReset().mockImplementation((identifier) => {
      scheduled = scheduled.filter((entry) => entry.identifier !== identifier);
      return Promise.resolve();
    });
    mocked.getAllScheduledNotificationsAsync.mockReset().mockImplementation(() => Promise.resolve([...scheduled]));
  });

  test('scheduling also cancels an orphan reminder the stored id never knew', async () => {
    scheduled.push(request('orphan', 'dailyReminder'), request('other-app-notification', 'other'));

    await turnOnReminder(USER, { hour: 7, minute: 30 }, 'en');

    expect(scheduled.map((entry) => entry.identifier)).toEqual(['other-app-notification', 'scheduled-1']);
  });

  test('turning it off cancels every scheduled reminder', async () => {
    await turnOnReminder(USER, { hour: 7, minute: 30 }, 'en');
    scheduled.push(request('orphan', 'dailyReminder'));

    await turnOffReminder(USER);

    expect(scheduled).toEqual([]);
  });

  test('a re-schedule queued while the account is deleted leaves no reminder scheduled', async () => {
    await turnOnReminder(USER, { hour: 7, minute: 30 }, 'en');

    const reschedule = scheduleReminder(USER, { hour: 9, minute: 0 }, 'en');
    forgetAccountOnDevice(USER);
    await reschedule;
    await forgetReminder(USER);

    expect(scheduled).toEqual([]);
  });

  test('a re-schedule asked for after the deletion schedules nothing', async () => {
    await turnOnReminder(USER, { hour: 7, minute: 30 }, 'en');

    forgetAccountOnDevice(USER);
    await expect(scheduleReminder(USER, { hour: 9, minute: 0 }, 'en')).resolves.toBe(false);

    expect(scheduled).toEqual([]);
  });
});

test("isReminderResponse: a tap on the reminder, not another notification's or an action button", () => {
  function response(data: Record<string, unknown>, actionIdentifier = Notifications.DEFAULT_ACTION_IDENTIFIER) {
    return { actionIdentifier, notification: { request: { content: { data } } } } as unknown as Notifications.NotificationResponse;
  }
  expect(isReminderResponse(response({ kind: 'dailyReminder', url: '/' }))).toBe(true);
  expect(isReminderResponse(response({ kind: 'other' }))).toBe(false);
  expect(isReminderResponse(response({ kind: 'dailyReminder' }, 'snooze'))).toBe(false);
});

describe('with a planned outfit', () => {
  // Saturday 21 November 2026, 10:00 on the device: a 07:30 reminder next fires on Sunday the 22nd.
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date(2026, 10, 21, 10, 0), doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'nextTick', 'queueMicrotask'] });
    let n = 0;
    mocked.scheduleNotificationAsync.mockReset().mockImplementation(() => {
      n += 1;
      return Promise.resolve(`weekly-${String(n)}`);
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  type Scheduled = { content: { title: string; body: string; data: unknown }; trigger: { type: string; weekday?: number; hour: number; minute: number } };
  const scheduledCalls = (): Scheduled[] => mocked.scheduleNotificationAsync.mock.calls.map(([input]) => input as unknown as Scheduled);

  test('a plan in the next seven reminders: one weekly reminder per weekday, the planned day naming its pieces', async () => {
    setReminderPlans(USER, { '2026-11-24': 'Blouse · White, Jeans · Blue' });

    await expect(turnOnReminder(USER, { hour: 7, minute: 30 }, 'en')).resolves.toBe('on');

    const calls = scheduledCalls();
    expect(calls).toHaveLength(7);
    expect(calls.map((call) => call.trigger.weekday).sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const call of calls) {
      expect(call.trigger).toMatchObject({ type: 'weekly', hour: 7, minute: 30, channelId: REMINDER_CHANNEL_ID });
      expect(call.content.data).toEqual({ kind: 'dailyReminder', url: '/', weekday: call.trigger.weekday });
    }
    // Tuesday is weekday 3 (Sunday is 1).
    expect(calls.find((call) => call.trigger.weekday === 3)?.content.body).toBe('You planned: Blouse · White, Jeans · Blue.');
    expect(calls.filter((call) => call.content.body === 'Open Today to see what to wear.')).toHaveLength(6);
    expect(readReminder(USER)).toMatchObject({
      enabled: true,
      notificationId: 'weekly-1',
      otherIds: ['weekly-2', 'weekly-3', 'weekly-4', 'weekly-5', 'weekly-6', 'weekly-7'],
    });
  });

  test('every weekly id is stored, so a re-schedule cancels all seven even when the OS listing fails', async () => {
    setReminderPlans(USER, { '2026-11-24': 'Blouse · White' });
    await turnOnReminder(USER, { hour: 7, minute: 30 }, 'en');
    mocked.getAllScheduledNotificationsAsync.mockRejectedValue(new Error('native'));
    mocked.cancelScheduledNotificationAsync.mockClear();

    await scheduleReminder(USER, { hour: 8, minute: 0 }, 'en');

    const cancelled = mocked.cancelScheduledNotificationAsync.mock.calls.map(([id]) => id).sort();
    expect(cancelled).toEqual(['weekly-1', 'weekly-2', 'weekly-3', 'weekly-4', 'weekly-5', 'weekly-6', 'weekly-7']);
    mocked.getAllScheduledNotificationsAsync.mockReset().mockResolvedValue([]);
  });

  test('turning off clears the stored weekly ids too', async () => {
    setReminderPlans(USER, { '2026-11-24': 'Blouse · White' });
    await turnOnReminder(USER, { hour: 7, minute: 30 }, 'en');

    await turnOffReminder(USER);

    expect(readReminder(USER)).toEqual({ enabled: false, hour: 7, minute: 30, notificationId: null, language: 'en' });
  });

  test('the Spanish text', async () => {
    setReminderPlans(USER, { '2026-11-22': 'Blusa · Blanco' });

    await turnOnReminder(USER, { hour: 7, minute: 30 }, 'es');

    expect(scheduledCalls().find((call) => call.trigger.weekday === 1)?.content.body).toBe('Planeaste: Blusa · Blanco.');
  });

  test('today’s plan counts while today’s reminder is still ahead', async () => {
    setReminderPlans(USER, { '2026-11-21': 'Blouse · White' });

    await turnOnReminder(USER, { hour: 18, minute: 0 }, 'en');

    // Saturday is weekday 7.
    expect(scheduledCalls().find((call) => call.trigger.weekday === 7)?.content.body).toBe('You planned: Blouse · White.');
  });

  test('a plan past the next seven reminders, or for a day whose reminder has passed, keeps the one daily reminder', async () => {
    setReminderPlans(USER, { '2026-11-29': 'Blouse · White', '2026-11-21': 'Jeans · Blue' });

    await turnOnReminder(USER, { hour: 7, minute: 30 }, 'en');

    expect(scheduledCalls()).toEqual([
      expect.objectContaining({ trigger: { type: 'daily', hour: 7, minute: 30, channelId: REMINDER_CHANNEL_ID } }),
    ]);
  });

  test('isReminderCurrent compares each weekday and text the OS holds with what the plans call for', async () => {
    type Held = { body: string; weekday: number | null };
    const held = (notes: Held[]): Notifications.NotificationRequest[] =>
      notes.map(
        ({ body, weekday }, i) =>
          ({ identifier: `r-${String(i)}`, content: { body, data: { kind: 'dailyReminder', weekday } }, trigger: null }) as unknown as Notifications.NotificationRequest,
      );
    const generic = 'Open Today to see what to wear.';
    const time = { hour: 7, minute: 30 };
    // The firings from Sunday the 22nd: weekdays 1 to 7, Tuesday the 24th is 3.
    const week = (planned: ReadonlyMap<number, string>): Held[] =>
      [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, body: planned.get(weekday) ?? generic }));

    mocked.getAllScheduledNotificationsAsync.mockResolvedValueOnce(held([{ body: generic, weekday: null }]));
    await expect(isReminderCurrent(USER, time, 'en')).resolves.toBe(true);

    // One daily note in another language's text is not current.
    mocked.getAllScheduledNotificationsAsync.mockResolvedValueOnce(held([{ body: 'Abre Hoy para ver qué ponerte.', weekday: null }]));
    await expect(isReminderCurrent(USER, time, 'en')).resolves.toBe(false);

    // A lone weekly note is not the daily one.
    mocked.getAllScheduledNotificationsAsync.mockResolvedValueOnce(held([{ body: generic, weekday: 3 }]));
    await expect(isReminderCurrent(USER, time, 'en')).resolves.toBe(false);

    setReminderPlans(USER, { '2026-11-24': 'Blouse · White' });
    mocked.getAllScheduledNotificationsAsync.mockResolvedValueOnce(held([{ body: generic, weekday: null }]));
    await expect(isReminderCurrent(USER, time, 'en')).resolves.toBe(false);

    mocked.getAllScheduledNotificationsAsync.mockResolvedValueOnce(held(week(new Map([[3, 'You planned: Blouse · White.']]))));
    await expect(isReminderCurrent(USER, time, 'en')).resolves.toBe(true);

    // The plan was removed: seven weekly reminders are no longer what's wanted.
    setReminderPlans(USER, {});
    mocked.getAllScheduledNotificationsAsync.mockResolvedValueOnce(held(week(new Map([[3, 'You planned: Blouse · White.']]))));
    await expect(isReminderCurrent(USER, time, 'en')).resolves.toBe(false);

    mocked.getAllScheduledNotificationsAsync.mockResolvedValueOnce([]);
    await expect(isReminderCurrent(USER, time, 'en')).resolves.toBe(false);
  });

  test('a plan moved to another day is not current, so the sync re-schedules it', async () => {
    const time = { hour: 7, minute: 30 };
    const generic = 'Open Today to see what to wear.';
    // Held: the plan on Tuesday (3). Wanted: the same pieces on Wednesday the 25th (4).
    const heldWeek = [1, 2, 3, 4, 5, 6, 7].map(
      (weekday) =>
        ({
          identifier: `r-${String(weekday)}`,
          content: { body: weekday === 3 ? 'You planned: Blouse · White.' : generic, data: { kind: 'dailyReminder', weekday } },
          trigger: null,
        }) as unknown as Notifications.NotificationRequest,
    );
    setReminderPlans(USER, { '2026-11-25': 'Blouse · White' });
    mocked.getAllScheduledNotificationsAsync.mockResolvedValueOnce(heldWeek);

    await expect(isReminderCurrent(USER, time, 'en')).resolves.toBe(false);
  });
});
