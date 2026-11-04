import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockStartAuthAutoRefresh = jest.fn(() => jest.fn());
let authStateCallback: ((event: string, session: { user: { id: string } } | null) => void) | undefined;
const mockOnAuthStateChange = jest.fn((callback: typeof authStateCallback) => {
  authStateCallback = callback;
  return { data: { subscription: { unsubscribe: jest.fn() } } };
});

jest.mock('../../lib/supabase', () => ({
  supabase: { auth: { onAuthStateChange: (cb: never) => mockOnAuthStateChange(cb) } },
  startAuthAutoRefresh: () => mockStartAuthAutoRefresh(),
}));

type FakeProfile = { onboarding_completed_at: string | null } | null;
const mockGetProfile = jest.fn<Promise<FakeProfile>, [string]>();
jest.mock('../../profile/profileRepository', () => ({
  getProfile: (userId: string): Promise<FakeProfile> => mockGetProfile(userId),
}));

import { AuthProvider, useAuth } from '../AuthProvider';

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  authStateCallback = undefined;
  mockGetProfile.mockResolvedValue(null);
});

test('starts in loading state and subscribes to auth changes', async () => {
  const { result } = await renderHook(() => useAuth(), { wrapper });

  expect(result.current.status).toBe('loading');
  expect(mockOnAuthStateChange).toHaveBeenCalledTimes(1);
  expect(mockStartAuthAutoRefresh).toHaveBeenCalledTimes(1);
});

test('moves to signedOut when the initial session is null', async () => {
  const { result } = await renderHook(() => useAuth(), { wrapper });

  await act(() => {
    authStateCallback?.('INITIAL_SESSION', null);
  });

  await waitFor(() => {
    expect(result.current.status).toBe('signedOut');
  });
  expect(result.current.userId).toBeNull();
});

test('moves to signedIn and loads onboardingComplete from the profile', async () => {
  mockGetProfile.mockResolvedValue({ onboarding_completed_at: '2026-01-01T00:00:00Z' });

  const { result } = await renderHook(() => useAuth(), { wrapper });

  await act(() => {
    authStateCallback?.('SIGNED_IN', { user: { id: 'user-1' } });
  });

  await waitFor(() => {
    expect(result.current.onboardingComplete).toBe(true);
  });
  expect(result.current.status).toBe('signedIn');
  expect(result.current.userId).toBe('user-1');
  expect(mockGetProfile).toHaveBeenCalledWith('user-1');
});

test('onboardingComplete is false when the profile has no onboarding_completed_at', async () => {
  mockGetProfile.mockResolvedValue({ onboarding_completed_at: null });

  const { result } = await renderHook(() => useAuth(), { wrapper });

  await act(() => {
    authStateCallback?.('SIGNED_IN', { user: { id: 'user-1' } });
  });

  await waitFor(() => {
    expect(result.current.status).toBe('signedIn');
  });
  expect(result.current.onboardingComplete).toBe(false);
});

test('status stays loading until the first loadProfile for the signed-in user settles', async () => {
  let resolveProfile: (profile: FakeProfile) => void = () => {};
  mockGetProfile.mockReturnValue(
    new Promise((resolve) => {
      resolveProfile = resolve;
    }),
  );

  const { result } = await renderHook(() => useAuth(), { wrapper });

  await act(() => {
    authStateCallback?.('SIGNED_IN', { user: { id: 'user-1' } });
  });

  // The profile fetch is still pending: status must not have jumped to signedIn yet.
  expect(result.current.status).toBe('loading');

  await act(async () => {
    resolveProfile({ onboarding_completed_at: null });
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(result.current.status).toBe('signedIn');
  });
});

test('refreshProfile re-fetches the profile for the current user', async () => {
  mockGetProfile.mockResolvedValue({ onboarding_completed_at: null });

  const { result } = await renderHook(() => useAuth(), { wrapper });
  await act(() => {
    authStateCallback?.('SIGNED_IN', { user: { id: 'user-1' } });
  });
  await waitFor(() => {
    expect(result.current.status).toBe('signedIn');
  });

  mockGetProfile.mockResolvedValue({ onboarding_completed_at: '2026-01-01T00:00:00Z' });
  await act(async () => {
    await result.current.refreshProfile();
  });

  expect(result.current.onboardingComplete).toBe(true);
  expect(mockGetProfile).toHaveBeenCalledTimes(2);
});

test('PASSWORD_RECOVERY keeps status signedOut rather than flipping to signedIn', async () => {
  const { result } = await renderHook(() => useAuth(), { wrapper });

  await act(() => {
    authStateCallback?.('INITIAL_SESSION', null);
  });
  await waitFor(() => {
    expect(result.current.status).toBe('signedOut');
  });

  await act(() => {
    authStateCallback?.('PASSWORD_RECOVERY', { user: { id: 'user-1' } });
  });

  expect(result.current.status).toBe('signedOut');
  expect(mockGetProfile).not.toHaveBeenCalled();
});

test('a subsequent USER_UPDATED after PASSWORD_RECOVERY moves to signedIn', async () => {
  mockGetProfile.mockResolvedValue({ onboarding_completed_at: null });
  const { result } = await renderHook(() => useAuth(), { wrapper });

  await act(() => {
    authStateCallback?.('PASSWORD_RECOVERY', { user: { id: 'user-1' } });
  });
  expect(result.current.status).toBe('loading');

  await act(() => {
    authStateCallback?.('USER_UPDATED', { user: { id: 'user-1' } });
  });

  await waitFor(() => {
    expect(result.current.status).toBe('signedIn');
  });
});

test('switching users without a SIGNED_OUT event never shows the previous user onboardingComplete', async () => {
  let resolveBProfile: (profile: FakeProfile) => void = () => {};
  mockGetProfile.mockImplementation((userId: string) => {
    if (userId === 'user-a') {
      return Promise.resolve({ onboarding_completed_at: '2026-01-01T00:00:00Z' });
    }
    return new Promise((resolve) => {
      resolveBProfile = resolve;
    });
  });

  const { result } = await renderHook(() => useAuth(), { wrapper });

  await act(() => {
    authStateCallback?.('SIGNED_IN', { user: { id: 'user-a' } });
  });
  await waitFor(() => {
    expect(result.current.onboardingComplete).toBe(true);
  });

  await act(() => {
    authStateCallback?.('SIGNED_IN', { user: { id: 'user-b' } });
  });

  // B's profile hasn't resolved yet: A's stale onboardingComplete must already be cleared.
  expect(result.current.onboardingComplete).toBe(false);
  expect(result.current.userId).toBe('user-b');

  await act(async () => {
    resolveBProfile({ onboarding_completed_at: null });
    await Promise.resolve();
  });
});

test('a getProfile rejection resolves to signedIn with onboardingComplete false, with no unhandled rejection', async () => {
  const unhandledRejections: unknown[] = [];
  const onUnhandledRejection = (reason: unknown): void => {
    unhandledRejections.push(reason);
  };
  process.on('unhandledRejection', onUnhandledRejection);

  mockGetProfile.mockRejectedValue(new Error('network down'));

  const { result } = await renderHook(() => useAuth(), { wrapper });

  await act(() => {
    authStateCallback?.('SIGNED_IN', { user: { id: 'user-1' } });
  });

  await waitFor(() => {
    expect(result.current.status).toBe('signedIn');
  });
  expect(result.current.onboardingComplete).toBe(false);

  // Flush the microtask queue once more so a same-tick unhandled rejection would have surfaced.
  await act(async () => {
    await Promise.resolve();
  });

  process.off('unhandledRejection', onUnhandledRejection);
  expect(unhandledRejections).toEqual([]);
});

test('unmount unsubscribes from auth state changes and stops auto-refresh', async () => {
  const { unmount } = await renderHook(() => useAuth(), { wrapper });

  const subscription = mockOnAuthStateChange.mock.results[0]?.value as {
    data: { subscription: { unsubscribe: jest.Mock } };
  };
  const stopAutoRefresh = mockStartAuthAutoRefresh.mock.results[0]?.value as jest.Mock;

  await unmount();

  expect(subscription.data.subscription.unsubscribe).toHaveBeenCalledTimes(1);
  expect(stopAutoRefresh).toHaveBeenCalledTimes(1);
});
