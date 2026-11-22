type Answer = { error: { message: string } | null };
const mockRpc = jest.fn<Promise<Answer>, [string, Record<string, unknown>]>(() => Promise.resolve({ error: null }));
const mockDeleteEq = jest.fn<Promise<Answer>, [string, string]>(() => Promise.resolve({ error: null }));
jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => mockRpc(name, args),
    from: () => ({ delete: () => ({ eq: mockDeleteEq }) }),
  },
}));
jest.mock('expo-crypto', () => ({ getRandomBytes: (size: number) => new Uint8Array(size).fill(0x1a) }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { eas: { projectId: 'project-1' } } } } }));

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';

import { I18nProvider } from '../../i18n/I18nProvider';
import { allowUserKeys, kvKeys, kvRemove } from '../../lib/kv';
import { PushSection } from '../PushSection';
import { readPush, writePush } from '../pushStore';

const mocked = jest.mocked(Notifications);
const USER_ID = 'user-1';
const TOKEN = 'ExponentPushToken[device-1]';

async function renderSection(): Promise<void> {
  await render(
    <I18nProvider>
      <PushSection userId={USER_ID} />
    </I18nProvider>,
  );
}

const reviewSwitch = () => screen.getByRole('switch', { name: 'Garments ready to review' });
const weeklySwitch = () => screen.getByRole('switch', { name: 'Weekly summary' });

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of kvKeys()) kvRemove(key);
  allowUserKeys(USER_ID);
});

test('both notices are off by default; turning one on saves the token with that choice', async () => {
  await renderSection();
  expect(reviewSwitch()).not.toBeChecked();
  expect(weeklySwitch()).not.toBeChecked();

  await fireEvent(reviewSwitch(), 'valueChange', true);

  await waitFor(() => {
    expect(reviewSwitch()).toBeChecked();
  });
  expect(weeklySwitch()).not.toBeChecked();
  expect(mockRpc).toHaveBeenCalledWith('register_push_token', {
    p_token: TOKEN,
    p_platform: 'ios',
    p_review_ready: true,
    p_weekly: false,
    p_device_secret: '1a'.repeat(32),
  });
});

test('turning the other on keeps the first', async () => {
  writePush(USER_ID, { token: TOKEN, reviewReady: true, weekly: false });
  await renderSection();

  await fireEvent(weeklySwitch(), 'valueChange', true);

  await waitFor(() => {
    expect(weeklySwitch()).toBeChecked();
  });
  expect(reviewSwitch()).toBeChecked();
  expect(mockRpc).toHaveBeenCalledWith('register_push_token', expect.objectContaining({ p_review_ready: true, p_weekly: true }));
});

test('turning the last one off deletes the token', async () => {
  writePush(USER_ID, { token: TOKEN, reviewReady: false, weekly: true });
  await renderSection();

  await fireEvent(weeklySwitch(), 'valueChange', false);

  await waitFor(() => {
    expect(mockDeleteEq).toHaveBeenCalledWith('token', TOKEN);
  });
  expect(readPush(USER_ID)).toEqual({ token: null, reviewReady: false, weekly: false });
  expect(weeklySwitch()).not.toBeChecked();
});

test('a phone without push set up says so, and the switch stays off', async () => {
  mocked.getExpoPushTokenAsync.mockRejectedValueOnce(new Error('no FCM'));
  await renderSection();

  await fireEvent(reviewSwitch(), 'valueChange', true);

  expect(await screen.findByText("Notifications aren't available on this phone yet.")).toBeTruthy();
  expect(reviewSwitch()).not.toBeChecked();
});

test('a denied permission explains and offers Settings', async () => {
  mocked.getPermissionsAsync.mockResolvedValueOnce({
    granted: false,
    canAskAgain: false,
    status: 'denied',
    expires: 'never',
  } as unknown as Notifications.NotificationPermissionsStatus);
  await renderSection();

  await fireEvent(weeklySwitch(), 'valueChange', true);

  expect(
    await screen.findByText('Notifications are off for Dressing Room. Turn them on in Settings to get these notices.'),
  ).toBeTruthy();
  expect(screen.getByRole('link', { name: /settings/i })).toBeTruthy();
  expect(weeklySwitch()).not.toBeChecked();
});

test('a failed save says so and keeps the switch as it was', async () => {
  mockRpc.mockResolvedValueOnce({ error: { message: 'offline' } });
  await renderSection();

  await fireEvent(reviewSwitch(), 'valueChange', true);

  expect(await screen.findByText("Couldn't save your notification settings. Try again.")).toBeTruthy();
  expect(reviewSwitch()).not.toBeChecked();
});
