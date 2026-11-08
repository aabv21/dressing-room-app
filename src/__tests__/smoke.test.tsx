// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return -- jest.mock()'s factory can only reference globals (incl. `require`), not a module-scoped import
jest.mock('../closet/ClosetProvider', () => require('../test/closetProvidersMock'));
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return -- same as above
jest.mock('../outfits/aiClient', () => require('../test/outfitClientsMock'));
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return -- same as above
jest.mock('../outfits/outfitRepository', () => require('../test/outfitClientsMock'));
jest.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ userId: 'user-1' }) }));
// Rendered outside a navigator, so there's no focus state to read.
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useIsFocused: () => true }));

import { render, screen } from '@testing-library/react-native';

import TodayScreen from '../app/(tabs)/index';

test('renders the Today screen', async () => {
  await render(<TodayScreen />);
  expect(screen.getByText('TODAY')).toBeOnTheScreen();
});
