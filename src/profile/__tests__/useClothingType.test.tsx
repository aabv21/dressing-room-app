import { act, renderHook } from '@testing-library/react-native';

import { resetAuth, setAuth } from '../../test/authMock';
import { useClothingType } from '../useClothingType';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return -- jest.mock()'s factory can only reference globals (incl. `require`), not a module-scoped import
jest.mock('../../auth/AuthProvider', () => require('../../test/authMock'));

test('offers every category until the profile is known, then follows its clothing type', async () => {
  resetAuth({ profile: null, profileStatus: 'loading' });
  const { result } = await renderHook(() => useClothingType());
  expect(result.current).toBe('everything');

  await act(async () => {
    setAuth({ profile: { clothing_type: 'masculine' }, profileStatus: 'ready' });
    await Promise.resolve();
  });

  expect(result.current).toBe('masculine');
});
