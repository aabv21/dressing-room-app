// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return -- jest.mock()'s factory can only reference globals (incl. `require`), not a module-scoped import
jest.mock('../../auth/AuthProvider', () => require('../../test/authMock'));
jest.mock('expo-router', () => ({ router: { navigate: jest.fn() } }));

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Pressable, Text } from 'react-native';

import { I18nProvider, useLocalePreference } from '../../i18n/I18nProvider';
import { allowUserKeys, kvKeys, kvRemove } from '../../lib/kv';
import { resetAuth } from '../../test/authMock';
import { DailyReminderSync } from '../DailyReminderSync';
import { readReminder, writeReminder } from '../reminderStore';

const mocked = jest.mocked(Notifications);
const USER = 'user-1';

function tap(data: Record<string, unknown>): Notifications.NotificationResponse {
  return {
    actionIdentifier: Notifications.DEFAULT_ACTION_IDENTIFIER,
    notification: { request: { content: { data } } },
  } as unknown as Notifications.NotificationResponse;
}

/** Switches the app to Spanish, as Profile's language toggle does. */
function SpanishButton(): React.JSX.Element {
  const { setPreference } = useLocalePreference();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        setPreference('es');
      }}
    >
      <Text>Español</Text>
    </Pressable>
  );
}

async function renderSync(): Promise<void> {
  await render(
    <I18nProvider>
      <SpanishButton />
      <DailyReminderSync />
    </I18nProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of kvKeys()) kvRemove(key);
  allowUserKeys(USER);
  resetAuth();
});

test('a reminder tap that launched the app opens Today and is cleared', async () => {
  mocked.getLastNotificationResponse.mockReturnValueOnce(tap({ kind: 'dailyReminder', url: '/' }));

  await renderSync();

  expect(router.navigate).toHaveBeenCalledWith('/');
  expect(mocked.clearLastNotificationResponse).toHaveBeenCalled();
});

test('a reminder tap while the app runs opens Today; the listener goes away on unmount', async () => {
  const remove = jest.fn();
  let listener: ((response: Notifications.NotificationResponse) => void) | undefined;
  mocked.addNotificationResponseReceivedListener.mockImplementationOnce((callback) => {
    listener = callback;
    return { remove };
  });
  const view = await render(
    <I18nProvider>
      <DailyReminderSync />
    </I18nProvider>,
  );

  await act(() => {
    listener?.(tap({ kind: 'dailyReminder', url: '/' }));
  });
  expect(router.navigate).toHaveBeenCalledWith('/');

  await view.unmount();
  expect(remove).toHaveBeenCalled();
});

test("another notification's tap doesn't navigate", async () => {
  mocked.getLastNotificationResponse.mockReturnValueOnce(tap({ kind: 'other' }));

  await renderSync();

  expect(router.navigate).not.toHaveBeenCalled();
  expect(mocked.clearLastNotificationResponse).not.toHaveBeenCalled();
});

function scheduledReminder(identifier: string): Notifications.NotificationRequest {
  return { identifier, content: { data: { kind: 'dailyReminder' } }, trigger: null } as unknown as Notifications.NotificationRequest;
}

test('a language change re-schedules the reminder in the new language', async () => {
  writeReminder(USER, { enabled: true, hour: 7, minute: 30, notificationId: 'reminder-1', language: 'en' });
  mocked.getAllScheduledNotificationsAsync.mockReset().mockResolvedValue([scheduledReminder('reminder-1')]);
  mocked.scheduleNotificationAsync.mockReset().mockResolvedValue('reminder-2');
  await renderSync();
  expect(mocked.scheduleNotificationAsync).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByRole('button', { name: 'Español' }));

  await act(() => Promise.resolve());
  expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledWith('reminder-1');
  expect(mocked.scheduleNotificationAsync).toHaveBeenCalledWith(
    expect.objectContaining({ content: expect.objectContaining({ title: 'Tu outfit de hoy está listo' }) as unknown }),
  );
  expect(readReminder(USER)).toMatchObject({ notificationId: 'reminder-2', language: 'es' });
});

test('an off reminder is never scheduled by a language change', async () => {
  writeReminder(USER, { enabled: false, hour: 7, minute: 30, notificationId: null, language: 'en' });
  await renderSync();

  await fireEvent.press(screen.getByRole('button', { name: 'Español' }));

  expect(mocked.scheduleNotificationAsync).not.toHaveBeenCalled();
});

test('on but no longer scheduled (a backup restore, an OS purge): mounting schedules it again', async () => {
  writeReminder(USER, { enabled: true, hour: 6, minute: 45, notificationId: 'gone', language: 'en' });
  mocked.getAllScheduledNotificationsAsync.mockReset().mockResolvedValue([]);
  mocked.scheduleNotificationAsync.mockReset().mockResolvedValue('reminder-2');

  await renderSync();
  await act(() => Promise.resolve());

  expect(mocked.scheduleNotificationAsync).toHaveBeenCalledWith(
    expect.objectContaining({ trigger: expect.objectContaining({ hour: 6, minute: 45 }) as unknown }),
  );
  expect(readReminder(USER)).toMatchObject({ enabled: true, notificationId: 'reminder-2' });
});

test('on and still scheduled in the same language: mounting changes nothing', async () => {
  writeReminder(USER, { enabled: true, hour: 6, minute: 45, notificationId: 'reminder-1', language: 'en' });
  mocked.getAllScheduledNotificationsAsync.mockReset().mockResolvedValue([scheduledReminder('reminder-1')]);

  await renderSync();
  await act(() => Promise.resolve());

  expect(mocked.scheduleNotificationAsync).not.toHaveBeenCalled();
});
