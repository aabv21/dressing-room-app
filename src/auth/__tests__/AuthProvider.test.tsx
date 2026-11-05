import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockStartAuthAutoRefresh = jest.fn(() => jest.fn());
let authStateCallback: ((event: string, session: { user: { id: string; email?: string } } | null) => void) | undefined;
const mockOnAuthStateChange = jest.fn((callback: typeof authStateCallback) => {
  authStateCallback = callback;
  return { data: { subscription: { unsubscribe: jest.fn() } } };
});

jest.mock('../../lib/supabase', () => ({
  supabase: { auth: { onAuthStateChange: (cb: never) => mockOnAuthStateChange(cb) } },
  startAuthAutoRefresh: () => mockStartAuthAutoRefresh(),
}));

type FakeProfile = { onboarding_completed_at: string | null; language?: 'en' | 'es' | null } | null;
const mockGetProfile = jest.fn<Promise<FakeProfile>, [string]>();
const mockSaveProfile = jest.fn<Promise<{ ok: true }>, [string, { language: 'en' | 'es' | null }]>(() =>
  Promise.resolve({ ok: true }),
);
jest.mock('../../profile/profileRepository', () => ({
  getProfile: (userId: string): Promise<FakeProfile> => mockGetProfile(userId),
  saveProfile: (userId: string, patch: { language: 'en' | 'es' | null }) => mockSaveProfile(userId, patch),
}));

import { I18nProvider, useLocalePreference } from '../../i18n/I18nProvider';
import { kvRemove, kvSet } from '../../lib/kv';
import { AuthProvider, useAuth } from '../AuthProvider';

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  authStateCallback = undefined;
  mockGetProfile.mockResolvedValue(null);
  kvRemove('locale-preference');
});

describe('language sync on sign-in (P2-R13)', () => {
  function i18nWrapper({ children }: { children: ReactNode }) {
    return (
      <I18nProvider>
        <AuthProvider>{children}</AuthProvider>
      </I18nProvider>
    );
  }

  function useBoth() {
    return { auth: useAuth(), locale: useLocalePreference() };
  }

  async function signIn(userId = 'user-1') {
    const view = await renderHook(useBoth, { wrapper: i18nWrapper });
    await act(() => {
      authStateCallback?.('SIGNED_IN', { user: { id: userId } });
    });
    await waitFor(() => {
      expect(view.result.current.auth.status).toBe('signedIn');
    });
    return view;
  }

  test("a saved profile language becomes this device's preference", async () => {
    mockGetProfile.mockResolvedValue({ onboarding_completed_at: null, language: 'es' });

    const { result } = await signIn();

    expect(result.current.locale.preference).toBe('es');
    expect(mockSaveProfile).not.toHaveBeenCalled();
  });

  test('with no saved language, an explicit device choice (Welcome toggle) is saved to the profile', async () => {
    kvSet('locale-preference', 'en');
    mockGetProfile.mockResolvedValue({ onboarding_completed_at: null, language: null });

    const { result } = await signIn();

    await waitFor(() => {
      expect(mockSaveProfile).toHaveBeenCalledWith('user-1', { language: 'en' });
    });
    expect(result.current.locale.preference).toBe('en');
  });

  test('with no saved language and the device default, nothing is saved or changed', async () => {
    mockGetProfile.mockResolvedValue({ onboarding_completed_at: null, language: null });

    const { result } = await signIn();

    expect(mockSaveProfile).not.toHaveBeenCalled();
    expect(result.current.locale.preference).toBe('system');
  });

  test('a later profile re-read for the same user does not override a newer local choice', async () => {
    mockGetProfile.mockResolvedValue({ onboarding_completed_at: null, language: 'es' });
    const { result } = await signIn();
    expect(result.current.locale.preference).toBe('es');

    await act(() => {
      result.current.locale.setPreference('en');
    });
    await act(() => {
      authStateCallback?.('TOKEN_REFRESHED', { user: { id: 'user-1' } });
    });
    await act(async () => {
      await result.current.auth.refreshProfile();
    });

    expect(result.current.locale.preference).toBe('en');
  });
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

test('refreshProfile resolves true when the read succeeds and false when it fails', async () => {
  mockGetProfile.mockResolvedValue({ onboarding_completed_at: null });

  const { result } = await renderHook(() => useAuth(), { wrapper });
  await act(() => {
    authStateCallback?.('SIGNED_IN', { user: { id: 'user-1' } });
  });
  await waitFor(() => {
    expect(result.current.status).toBe('signedIn');
  });

  let refreshed: boolean | undefined;
  await act(async () => {
    refreshed = await result.current.refreshProfile();
  });
  expect(refreshed).toBe(true);

  mockGetProfile.mockRejectedValueOnce(new TypeError('Network request failed'));
  await act(async () => {
    refreshed = await result.current.refreshProfile();
  });
  expect(refreshed).toBe(false);
});

test('exposes the signed-in email, and clears it on sign-out', async () => {
  const { result } = await renderHook(() => useAuth(), { wrapper });

  await act(() => {
    authStateCallback?.('SIGNED_IN', { user: { id: 'user-1', email: 'ana@example.com' } });
  });
  await waitFor(() => {
    expect(result.current.status).toBe('signedIn');
  });
  expect(result.current.email).toBe('ana@example.com');

  await act(() => {
    authStateCallback?.('SIGNED_OUT', null);
  });
  expect(result.current.email).toBeNull();
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
