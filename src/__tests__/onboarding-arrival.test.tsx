// Where the root guard lands once onboarding finishes, through the REAL route tree and navigator.
// `useAuth()` is backed by a small external store here (rather than a plain jest.fn) so a state
// change re-renders the guard the way AuthProvider's own state does.
type MockAuthState = {
  status: 'loading' | 'signedOut' | 'signedIn';
  userId: string | null;
  email: string | null;
  onboardingComplete: boolean;
  refreshProfile: () => Promise<boolean>;
};

let mockAuthState: MockAuthState = {
  status: 'signedIn',
  userId: 'user-1',
  email: null,
  onboardingComplete: false,
  refreshProfile: () => Promise.resolve(true),
};
const mockAuthListeners = new Set<() => void>();

// The closet providers wrap the signed-in navigator; this suite doesn't test the closet.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return -- jest.mock()'s factory can only reference globals (incl. `require`), not a module-scoped import
jest.mock('../closet/ClosetProvider', () => require('../test/closetProvidersMock'));
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return -- same as above
jest.mock('../closet/UploadQueueProvider', () => require('../test/closetProvidersMock'));

jest.mock('../auth/AuthProvider', () => {
  const { useSyncExternalStore } = jest.requireActual<typeof import('react')>('react');
  return {
    AuthProvider: ({ children }: { children?: React.ReactNode }) => children,
    useAuth: () =>
      useSyncExternalStore(
        (listener: () => void) => {
          mockAuthListeners.add(listener);
          return () => {
            mockAuthListeners.delete(listener);
          };
        },
        () => mockAuthState,
      ),
  };
});

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

// Only which route the guard picks matters here, so the onboarding layout's profile read never
// settles.
jest.mock('../profile/profileRepository', () => ({
  getProfile: jest.fn(() => new Promise(() => undefined)),
  saveProfile: jest.fn(),
  completeOnboarding: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return -- jest.mock()'s factory can only reference globals (incl. `require`), not a module-scoped import.
jest.mock('@shopify/flash-list', () => require('../test/flashListMock'));

jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationButton: () => null,
  AppleAuthenticationButtonType: { CONTINUE: 1 },
  AppleAuthenticationButtonStyle: { BLACK: 2 },
}));

import { act, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

async function setAuth(next: Partial<MockAuthState>): Promise<void> {
  mockAuthState = { ...mockAuthState, ...next };
  await act(() => {
    mockAuthListeners.forEach((listener) => {
      listener();
    });
  });
}

beforeEach(() => {
  mockAuthState = { ...mockAuthState, status: 'signedIn', userId: 'user-1', onboardingComplete: false };
});

test('finishing onboarding lands on the Closet, not Today', async () => {
  const router = await renderRouter({ appDir: 'src/app', overrides: {} }, { initialUrl: '/' });
  expect(router.getSegments()).toContain('(onboarding)');

  await setAuth({ onboardingComplete: true });

  await waitFor(() => {
    expect(router.getPathname()).toBe('/closet');
  });
  expect(router.getSegments()).toContain('(tabs)');
});

test('a launch with onboarding already complete still opens on Today', async () => {
  mockAuthState = { ...mockAuthState, onboardingComplete: true };

  const router = await renderRouter({ appDir: 'src/app', overrides: {} }, { initialUrl: '/' });

  expect(router.getPathname()).toBe('/');
});

test("switching to another account that already finished onboarding opens on Today", async () => {
  const router = await renderRouter({ appDir: 'src/app', overrides: {} }, { initialUrl: '/' });
  expect(router.getSegments()).toContain('(onboarding)');

  await setAuth({ status: 'loading', userId: 'user-2' });
  await setAuth({ status: 'signedIn', onboardingComplete: true });

  await waitFor(() => {
    expect(router.getSegments()).toContain('(tabs)');
  });
  expect(router.getPathname()).toBe('/');
});
