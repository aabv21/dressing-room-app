// Uses expo-router's own testing library against the REAL route tree and navigator (not a
// Stack/Stack.Protected test double), confirmed to work with this repo's installed expo-router
// 58.0.29: `renderRouter({ appDir: 'src/app', overrides: {} }, options)` resolves against the real
// filesystem tree under `src/app` (see node_modules/expo-router/build/testing-library/
// context-stubs.js's `requireContextWithOverrides`, which requires a real `overrides` object —
// `{}` here, since this suite overrides no individual route). Because this file renders through
// the real navigator, `expo-router` itself must NOT be mocked here (unlike auth-screens.test.tsx,
// which renders screens in isolation and mocks `router`); AuthProvider stays mocked at the
// `useAuth()` seam so each case can drive an exact status/onboardingComplete combination.
// The closet providers wrap the signed-in navigator; this suite doesn't test the closet.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return -- jest.mock()'s factory can only reference globals (incl. `require`), not a module-scoped import
jest.mock('../closet/ClosetProvider', () => require('../test/closetProvidersMock'));
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return -- same as above
jest.mock('../closet/UploadQueueProvider', () => require('../test/closetProvidersMock'));

jest.mock('../auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children?: React.ReactNode }) => children,
  useAuth: jest.fn(() => ({
    status: 'signedOut',
    userId: null,
    onboardingComplete: false,
    email: null,
    refreshProfile: jest.fn(() => Promise.resolve(true)),
  })),
}));

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve()),
  hideAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('../auth/authService', () => ({
  signUpWithEmail: jest.fn(),
  signInWithEmail: jest.fn(),
  requestPasswordReset: jest.fn(),
  confirmPasswordReset: jest.fn(),
  signInWithApple: jest.fn(),
  signInWithGoogle: jest.fn(),
  signOut: jest.fn(),
}));

// The (onboarding) layout reads the profile on mount; this suite only checks which group the guard
// picks, so the read never settles here.
jest.mock('../profile/profileRepository', () => ({
  getProfile: jest.fn(() => new Promise(() => undefined)),
  saveProfile: jest.fn(),
  completeOnboarding: jest.fn(),
}));

jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationButton: () => null,
  AppleAuthenticationButtonType: { CONTINUE: 1 },
  AppleAuthenticationButtonStyle: { BLACK: 2 },
}));

import * as SplashScreen from 'expo-splash-screen';
import { renderRouter } from 'expo-router/testing-library';
import { waitFor } from '@testing-library/react-native';

import { useAuth } from '../auth/AuthProvider';

const mockedUseAuth = jest.mocked(useAuth);

type AuthState = { status: 'loading' | 'signedOut' | 'signedIn'; userId: string | null; email: string | null; onboardingComplete: boolean; refreshProfile: () => Promise<boolean> };

function authState(overrides: Partial<AuthState>): AuthState {
  return { status: 'signedOut', userId: null, email: null, onboardingComplete: false, refreshProfile: jest.fn(), ...overrides };
}

function renderAt(initialUrl: string) {
  return renderRouter({ appDir: 'src/app', overrides: {} }, { initialUrl });
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('loading (first settle) renders no route and keeps the splash screen up', async () => {
  mockedUseAuth.mockReturnValue(authState({ status: 'loading' }));
  await renderAt('/');

  expect(SplashScreen.hideAsync).not.toHaveBeenCalled();
});

test('signedOut resolves to /welcome and hides the splash screen once settled', async () => {
  mockedUseAuth.mockReturnValue(authState({ status: 'signedOut' }));
  const result = await renderAt('/');

  expect(result.getPathname()).toBe('/welcome');
  await waitFor(() => {
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
  });
});

test('a deep link to /closet while signed out lands on /welcome instead', async () => {
  mockedUseAuth.mockReturnValue(authState({ status: 'signedOut' }));
  const result = await renderAt('/closet');

  expect(result.getPathname()).toBe('/welcome');
});

test('signedIn with incomplete onboarding resolves into the (onboarding) group', async () => {
  mockedUseAuth.mockReturnValue(
    authState({ status: 'signedIn', userId: 'user-1', onboardingComplete: false }),
  );
  const result = await renderAt('/');

  expect(result.getSegments()).toContain('(onboarding)');
});

test('signedIn with complete onboarding resolves into the (tabs) group at /', async () => {
  mockedUseAuth.mockReturnValue(
    authState({ status: 'signedIn', userId: 'user-1', onboardingComplete: true }),
  );
  const result = await renderAt('/');

  expect(result.getSegments()).toContain('(tabs)');
  expect(result.getPathname()).toBe('/');
});
