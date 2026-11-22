jest.mock('expo-router', () => ({ router: { navigate: jest.fn() } }));

import { act, render } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

import { PushTapSync } from '../PushTapSync';

const mocked = jest.mocked(Notifications);

function tap(data: Record<string, unknown>, actionIdentifier = Notifications.DEFAULT_ACTION_IDENTIFIER): Notifications.NotificationResponse {
  return { actionIdentifier, notification: { request: { content: { data } } } } as unknown as Notifications.NotificationResponse;
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('a "ready to review" tap that launched the app opens Review and is cleared', async () => {
  mocked.getLastNotificationResponse.mockReturnValueOnce(tap({ kind: 'reviewReady', url: '/review' }));

  await render(<PushTapSync />);

  expect(router.navigate).toHaveBeenCalledWith('/review');
  expect(mocked.clearLastNotificationResponse).toHaveBeenCalled();
});

test('a weekly summary tap while the app runs opens Stats; the listener goes away on unmount', async () => {
  const remove = jest.fn();
  let listener: ((response: Notifications.NotificationResponse) => void) | undefined;
  mocked.addNotificationResponseReceivedListener.mockImplementationOnce((callback) => {
    listener = callback;
    return { remove };
  });
  const view = await render(<PushTapSync />);

  await act(() => {
    listener?.(tap({ kind: 'weeklySummary', url: '/closet?segment=stats' }));
  });

  expect(router.navigate).toHaveBeenCalledWith('/closet?segment=stats');
  await view.unmount();
  expect(remove).toHaveBeenCalled();
});

test.each([
  ['the daily reminder (its own listener handles it)', tap({ kind: 'dailyReminder', url: '/' })],
  ['an unknown kind, whatever url it names', tap({ kind: 'other', url: '/stylist' })],
  ['an action button rather than the notice itself', tap({ kind: 'reviewReady' }, 'snooze')],
])('ignores %s', async (_label, response) => {
  mocked.getLastNotificationResponse.mockReturnValueOnce(response);

  await render(<PushTapSync />);

  expect(router.navigate).not.toHaveBeenCalled();
  expect(mocked.clearLastNotificationResponse).not.toHaveBeenCalled();
});
