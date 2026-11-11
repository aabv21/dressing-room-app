jest.mock('../authService', () => ({ signOut: jest.fn() }));
jest.mock('../AuthProvider', () => ({ useAuth: () => ({ userId: 'user-1' }) }));

import { act, renderHook } from '@testing-library/react-native';

import { allowUserKeys, kvKeys, kvRemove, kvSet } from '../../lib/kv';
import { signOut } from '../authService';
import { useSignOut } from '../useSignOut';

const mockedSignOut = jest.mocked(signOut);

beforeEach(() => {
  // Signing in lifts the refusal a previous sign-out left.
  allowUserKeys('user-1');
  for (const key of kvKeys()) kvRemove(key);
  kvSet('closet.v1.user-1', 'x');
  kvSet('wear.queue.user-1', 'x');
});

test('an explicit sign-out drops the display caches but keeps the upload and wear queues', async () => {
  mockedSignOut.mockResolvedValue({ ok: true });
  const { result } = await renderHook(() => useSignOut());

  await act(async () => {
    result.current.signOut();
    await Promise.resolve();
  });

  expect(kvKeys()).toEqual(['wear.queue.user-1']);
});

test('a failed sign-out keeps everything', async () => {
  mockedSignOut.mockResolvedValue({ ok: false, error: 'auth.error.network' });
  const { result } = await renderHook(() => useSignOut());

  await act(async () => {
    result.current.signOut();
    await Promise.resolve();
  });

  expect(kvKeys().sort()).toEqual(['closet.v1.user-1', 'wear.queue.user-1']);
});
