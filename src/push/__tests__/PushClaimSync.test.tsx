jest.mock('../pushRegistration', () => ({
  confirmPushClaim: jest.fn(() => Promise.resolve(true)),
  resumePushClaim: jest.fn(() => Promise.resolve()),
}));

import { act, render } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';

import { PushClaimSync } from '../PushClaimSync';
import { confirmPushClaim, resumePushClaim } from '../pushRegistration';

const mocked = jest.mocked(Notifications);

function received(data: Record<string, unknown>): Notifications.Notification {
  return { request: { content: { data } } } as unknown as Notifications.Notification;
}

let listener: ((notification: Notifications.Notification) => void) | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  listener = undefined;
  mocked.addNotificationReceivedListener.mockImplementation((callback) => {
    listener = callback;
    return { remove: jest.fn() };
  });
});

test('resumes this account’s pending claim when mounted (a launch or a sign-in)', async () => {
  await render(<PushClaimSync userId="user-1" />);
  expect(resumePushClaim).toHaveBeenCalledWith('user-1');
});

test('a claim code push is handed to confirmPushClaim for this account', async () => {
  await render(<PushClaimSync userId="user-1" />);

  await act(() => {
    listener?.(received({ type: 'push-claim', code: 'K7M2P9QX', nonce: 'a1'.repeat(16) }));
  });

  expect(confirmPushClaim).toHaveBeenCalledWith('K7M2P9QX', 'a1'.repeat(16), 'user-1');
});

test.each([
  ['a visible notice', { kind: 'reviewReady', url: '/review' }],
  ['a claim push without a code', { type: 'push-claim' }],
  ['a code that isn’t a string', { type: 'push-claim', code: 12345678, nonce: 'a1'.repeat(16) }],
  ['a claim push without a nonce', { type: 'push-claim', code: 'K7M2P9QX' }],
])('ignores %s', async (_label, data) => {
  await render(<PushClaimSync userId="user-1" />);

  await act(() => {
    listener?.(received(data));
  });

  expect(confirmPushClaim).not.toHaveBeenCalled();
});

test('stops listening on unmount', async () => {
  const remove = jest.fn();
  mocked.addNotificationReceivedListener.mockImplementationOnce(() => ({ remove }));
  const view = await render(<PushClaimSync userId="user-1" />);
  await view.unmount();
  expect(remove).toHaveBeenCalled();
});
