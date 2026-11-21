// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return -- the time sheet reads Reduce Motion; see src/test/reanimatedMock.ts's module doc
jest.mock('react-native-reanimated', () => require('../../test/reanimatedMock'));

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { Linking } from 'react-native';

import { I18nProvider } from '../../i18n/I18nProvider';
import { allowUserKeys, kvKeys, kvRemove, kvSet } from '../../lib/kv';
import { scheduleReminder } from '../dailyReminder';
import { ReminderSection } from '../ReminderSection';
import { readReminder, writeReminder } from '../reminderStore';

const mocked = jest.mocked(Notifications);
const USER_ID = 'user-1';

function deniedStatus(): Notifications.NotificationPermissionsStatus {
  return { granted: false, canAskAgain: false, status: 'denied', expires: 'never' } as unknown as Notifications.NotificationPermissionsStatus;
}

async function renderSection(): Promise<void> {
  await render(
    <I18nProvider>
      <ReminderSection userId={USER_ID} />
    </I18nProvider>,
  );
}

function reminderSwitch() {
  return screen.getByRole('switch', { name: 'Daily notification' });
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of kvKeys()) kvRemove(key);
  allowUserKeys(USER_ID);
  mocked.scheduleNotificationAsync.mockReset().mockResolvedValue('reminder-1');
});

test('off by default at 7:30; turning it on asks for permission and schedules the daily notification', async () => {
  await renderSection();

  expect(reminderSwitch()).not.toBeChecked();
  expect(screen.getByRole('button', { name: /^Time, 7:30\sAM$/ })).toBeTruthy();

  await fireEvent(reminderSwitch(), 'valueChange', true);

  await waitFor(() => {
    expect(reminderSwitch()).toBeChecked();
  });
  expect(mocked.getPermissionsAsync).toHaveBeenCalled();
  expect(mocked.scheduleNotificationAsync).toHaveBeenCalledWith(
    expect.objectContaining({ trigger: expect.objectContaining({ type: 'daily', hour: 7, minute: 30 }) as unknown }),
  );
  expect(readReminder(USER_ID)).toMatchObject({ enabled: true, notificationId: 'reminder-1' });
});

test('a new time re-schedules: the previous notification is cancelled first', async () => {
  writeReminder(USER_ID, { enabled: true, hour: 7, minute: 30, notificationId: 'reminder-1', language: 'en' });
  mocked.scheduleNotificationAsync.mockResolvedValueOnce('reminder-2');
  await renderSection();
  expect(reminderSwitch()).toBeChecked();

  await fireEvent.press(screen.getByRole('button', { name: /^Time, 7:30\sAM$/ }));
  const sheet = await screen.findByTestId('reminder-time-sheet');
  await fireEvent.press(within(sheet).getByRole('radio', { name: /^8\sAM$/ }));
  await fireEvent.press(within(sheet).getByRole('radio', { name: ':15' }));
  await fireEvent.press(within(sheet).getByRole('button', { name: 'Done' }));

  await waitFor(() => {
    expect(mocked.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: expect.objectContaining({ hour: 8, minute: 15 }) as unknown }),
    );
  });
  expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledWith('reminder-1');
  expect(await screen.findByRole('button', { name: /^Time, 8:15\sAM$/ })).toBeTruthy();
  expect(readReminder(USER_ID)).toMatchObject({ hour: 8, minute: 15, notificationId: 'reminder-2' });
});

test('with the reminder off, a new time is kept for later and nothing is scheduled', async () => {
  await renderSection();

  await fireEvent.press(screen.getByRole('button', { name: /^Time, 7:30\sAM$/ }));
  const sheet = await screen.findByTestId('reminder-time-sheet');
  await fireEvent.press(within(sheet).getByRole('radio', { name: /^6\sAM$/ }));
  await fireEvent.press(within(sheet).getByRole('button', { name: 'Done' }));

  expect(await screen.findByRole('button', { name: /^Time, 6:30\sAM$/ })).toBeTruthy();
  expect(mocked.scheduleNotificationAsync).not.toHaveBeenCalled();
  expect(readReminder(USER_ID)).toMatchObject({ enabled: false, hour: 6, minute: 30 });
});

test('turning it off cancels the notification', async () => {
  writeReminder(USER_ID, { enabled: true, hour: 7, minute: 30, notificationId: 'reminder-1', language: 'en' });
  await renderSection();

  await fireEvent(reminderSwitch(), 'valueChange', false);

  await waitFor(() => {
    expect(reminderSwitch()).not.toBeChecked();
  });
  expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledWith('reminder-1');
  expect(readReminder(USER_ID)).toMatchObject({ enabled: false, notificationId: null });
});

test('denied keeps it off, explains why and offers Open settings', async () => {
  mocked.getPermissionsAsync.mockResolvedValueOnce(deniedStatus());
  const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  await renderSection();

  await fireEvent(reminderSwitch(), 'valueChange', true);

  expect(
    await screen.findByText('Notifications are off for Dressing Room. Turn them on in Settings to get the reminder.'),
  ).toBeTruthy();
  expect(reminderSwitch()).not.toBeChecked();
  expect(mocked.scheduleNotificationAsync).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByRole('link', { name: 'Open settings' }));
  expect(openSettings).toHaveBeenCalled();
});

test('a scheduling failure says so and stays off', async () => {
  mocked.scheduleNotificationAsync.mockRejectedValueOnce(new Error('native'));
  await renderSection();

  await fireEvent(reminderSwitch(), 'valueChange', true);

  expect(await screen.findByText("Couldn't set the reminder. Try again.")).toBeTruthy();
  expect(reminderSwitch()).not.toBeChecked();
});

test('in Spanish', async () => {
  kvSet('locale-preference', 'es');
  await renderSection();

  expect(screen.getByRole('switch', { name: 'Notificación diaria' })).toBeTruthy();
  expect(screen.getByRole('button', { name: /^Hora, 7:30/ })).toBeTruthy();
});

test('a re-schedule that fails elsewhere (a language change) turns the switch off here too', async () => {
  writeReminder(USER_ID, { enabled: true, hour: 7, minute: 30, notificationId: 'reminder-1', language: 'en' });
  await renderSection();
  expect(reminderSwitch()).toBeChecked();

  mocked.scheduleNotificationAsync.mockRejectedValueOnce(new Error('native'));
  await act(() => scheduleReminder(USER_ID, { hour: 7, minute: 30 }, 'es'));

  expect(reminderSwitch()).not.toBeChecked();
});
