// I3 regression: a `Stack`/`Stack.Protected` test double (not `renderRouter`'s real navigator —
// see auth-guards.test.tsx for that) because this test needs to re-render the SAME mounted tree
// across a status transition and assert which screen NAMES stayed mounted versus which were torn
// down; `renderRouter` manages its own render lifecycle per call and doesn't expose a `rerender`
// bound to a live `useAuth()` mock the way `@testing-library/react-native`'s own `render(...).rerender`
// does.
jest.mock('../auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children?: React.ReactNode }) => children,
  useAuth: jest.fn(() => ({
    status: 'signedOut',
    userId: null,
    onboardingComplete: false,
    refreshProfile: jest.fn(() => Promise.resolve()),
  })),
}));

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve()),
  hideAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-router', () => {
  function StackScreen({ name }: { name: string }) {
    const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
    return <Text>{name}</Text>;
  }
  function StackProtected({ guard, children }: { guard: boolean; children?: React.ReactNode }) {
    return guard ? children : null;
  }
  function Stack({ children }: { children?: React.ReactNode }) {
    return children;
  }
  Stack.Screen = StackScreen;
  Stack.Protected = StackProtected;
  return { Stack };
});

import { render, screen } from '@testing-library/react-native';

import { useAuth } from '../auth/AuthProvider';
import RootLayout from '../app/_layout';

const mockedUseAuth = jest.mocked(useAuth);

beforeEach(() => {
  jest.clearAllMocks();
});

test('a loading transition after the first settle keeps (auth) mounted instead of unmounting the navigator (I3)', async () => {
  mockedUseAuth.mockReturnValue({
    status: 'signedOut',
    userId: null,
    onboardingComplete: false,
    refreshProfile: jest.fn(() => Promise.resolve()),
  });
  const view = await render(<RootLayout />);

  expect(screen.getByText('(auth)')).toBeTruthy();

  // Simulate AuthProvider moving back to 'loading' for a user change mid-session (e.g. the moment
  // signInWithEmail succeeds, before loadProfile resolves) — the first version of this guard
  // returned `null` unconditionally for 'loading', which unmounted '(auth)' entirely here.
  mockedUseAuth.mockReturnValue({
    status: 'loading',
    userId: 'user-1',
    onboardingComplete: false,
    refreshProfile: jest.fn(() => Promise.resolve()),
  });
  await view.rerender(<RootLayout />);

  expect(screen.getByText('(auth)')).toBeTruthy();
  expect(screen.getByTestId('auth-busy-overlay')).toBeTruthy();
});

test('the first-ever render (never settled) renders no screen name', async () => {
  mockedUseAuth.mockReturnValue({
    status: 'loading',
    userId: null,
    onboardingComplete: false,
    refreshProfile: jest.fn(() => Promise.resolve()),
  });
  await render(<RootLayout />);

  expect(screen.queryByText('(auth)')).toBeNull();
  expect(screen.queryByText('(onboarding)')).toBeNull();
  expect(screen.queryByText('(tabs)')).toBeNull();
});
