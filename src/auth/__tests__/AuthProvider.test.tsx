import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockStartAuthAutoRefresh = jest.fn(() => jest.fn());
let authStateCallback: ((event: string, session: { user: { id: string; email?: string } } | null) => void) | undefined;
const mockOnAuthStateChange = jest.fn((callback: typeof authStateCallback) => {
  authStateCallback = callback;
  return { data: { subscription: { unsubscribe: jest.fn() } } };
});

const mockReadStoredSession = jest.fn<{ userId: string; email: string | null } | null, []>(() => null);

jest.mock('../../lib/supabase', () => ({
  supabase: { auth: { onAuthStateChange: (cb: never) => mockOnAuthStateChange(cb) } },
  startAuthAutoRefresh: () => mockStartAuthAutoRefresh(),
  readStoredSession: () => mockReadStoredSession(),
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
import { kvGet, kvRemove, kvSet } from '../../lib/kv';
import { AuthProvider, useAuth } from '../AuthProvider';

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  authStateCallback = undefined;
  mockGetProfile.mockResolvedValue(null);
  mockReadStoredSession.mockReturnValue(null);
  kvRemove('locale-preference');
  kvRemove('onboarding-complete');
  kvRemove('language-save-pending');
});

const offline = (): Promise<never> => Promise.reject(new TypeError('Network request failed'));

describe('offline launch', () => {
  test('an expired session that could not be refreshed offline stays signed in as the stored user', async () => {
    mockReadStoredSession.mockReturnValue({ userId: 'user-1', email: 'ana@example.com' });
    mockGetProfile.mockImplementation(offline);

    const { result } = await renderHook(() => useAuth(), { wrapper });
    await act(() => {
      // supabase-js reports no session when the refresh of an expired token fails for lack of network.
      authStateCallback?.('INITIAL_SESSION', null);
    });

    await waitFor(() => {
      expect(result.current.status).toBe('signedIn');
    });
    expect(result.current.userId).toBe('user-1');
    expect(result.current.email).toBe('ana@example.com');
  });

  test('with no stored session, a null INITIAL_SESSION signs out', async () => {
    const { result } = await renderHook(() => useAuth(), { wrapper });
    await act(() => {
      authStateCallback?.('INITIAL_SESSION', null);
    });

    expect(result.current.status).toBe('signedOut');
    expect(mockGetProfile).not.toHaveBeenCalled();
  });

  test('an explicit SIGNED_OUT still signs out, and the stored session is not consulted for it', async () => {
    mockReadStoredSession.mockReturnValue({ userId: 'user-1', email: null });
    mockGetProfile.mockImplementation(offline);
    const { result } = await renderHook(() => useAuth(), { wrapper });
    await act(() => {
      authStateCallback?.('INITIAL_SESSION', null);
    });
    await waitFor(() => {
      expect(result.current.status).toBe('signedIn');
    });

    await act(() => {
      authStateCallback?.('SIGNED_OUT', null);
    });

    expect(result.current.status).toBe('signedOut');
    expect(result.current.userId).toBeNull();
  });

  test('a later TOKEN_REFRESHED settles it with the real profile', async () => {
    mockReadStoredSession.mockReturnValue({ userId: 'user-1', email: null });
    mockGetProfile.mockImplementation(offline);
    const { result } = await renderHook(() => useAuth(), { wrapper });
    await act(() => {
      authStateCallback?.('INITIAL_SESSION', null);
    });
    await waitFor(() => {
      expect(result.current.status).toBe('signedIn');
    });
    expect(result.current.onboardingComplete).toBe(false);

    mockGetProfile.mockResolvedValue({ onboarding_completed_at: '2026-01-01T00:00:00Z' });
    await act(() => {
      authStateCallback?.('TOKEN_REFRESHED', { user: { id: 'user-1' } });
    });

    await waitFor(() => {
      expect(result.current.onboardingComplete).toBe(true);
    });
  });

  test('a finished user who launches offline lands on the tabs: the last known onboarding flag is kept on the device', async () => {
    mockGetProfile.mockResolvedValue({ onboarding_completed_at: '2026-01-01T00:00:00Z' });
    const first = await renderHook(() => useAuth(), { wrapper });
    await act(() => {
      authStateCallback?.('SIGNED_IN', { user: { id: 'user-1' } });
    });
    await waitFor(() => {
      expect(first.result.current.onboardingComplete).toBe(true);
    });
    await first.unmount();

    // Next launch: no network.
    mockReadStoredSession.mockReturnValue({ userId: 'user-1', email: null });
    mockGetProfile.mockImplementation(offline);
    const { result } = await renderHook(() => useAuth(), { wrapper });
    await act(() => {
      authStateCallback?.('INITIAL_SESSION', null);
    });

    await waitFor(() => {
      expect(result.current.status).toBe('signedIn');
    });
    expect(result.current.onboardingComplete).toBe(true);
  });

  test('while the restored session is unconfirmed, a profile read that finds no row counts as a failed read', async () => {
    // Without a refreshed token the request goes out with the anon key, and RLS hides the row.
    kvSet('onboarding-complete', JSON.stringify({ userId: 'user-1', complete: true }));
    mockReadStoredSession.mockReturnValue({ userId: 'user-1', email: null });
    mockGetProfile.mockResolvedValue(null);
    const { result } = await renderHook(() => useAuth(), { wrapper });
    await act(() => {
      authStateCallback?.('INITIAL_SESSION', null);
    });

    await waitFor(() => {
      expect(result.current.status).toBe('signedIn');
    });
    expect(result.current.onboardingComplete).toBe(true);
    let refreshed: boolean | undefined;
    await act(async () => {
      refreshed = await result.current.refreshProfile();
    });
    expect(refreshed).toBe(false);
  });

  test('signing out clears the cached onboarding flag', async () => {
    mockGetProfile.mockResolvedValue({ onboarding_completed_at: '2026-01-01T00:00:00Z' });
    const { result } = await renderHook(() => useAuth(), { wrapper });
    await act(() => {
      authStateCallback?.('SIGNED_IN', { user: { id: 'user-1' } });
    });
    await waitFor(() => {
      expect(result.current.onboardingComplete).toBe(true);
    });
    expect(kvGet('onboarding-complete')).not.toBeNull();

    await act(() => {
      authStateCallback?.('SIGNED_OUT', null);
    });

    expect(kvGet('onboarding-complete')).toBeNull();
  });

  test("another account never inherits the cached flag: it is dropped on an account switch", async () => {
    kvSet('onboarding-complete', JSON.stringify({ userId: 'user-a', complete: true }));
    mockGetProfile.mockImplementation(offline);
    const { result } = await renderHook(() => useAuth(), { wrapper });

    await act(() => {
      authStateCallback?.('SIGNED_IN', { user: { id: 'user-b' } });
    });

    await waitFor(() => {
      expect(result.current.status).toBe('signedIn');
    });
    expect(result.current.onboardingComplete).toBe(false);
    expect(kvGet('onboarding-complete')).toBeNull();
  });
});

describe('language sync on sign-in', () => {
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

  test('a failed save of the device choice is remembered and retried on the next profile load', async () => {
    kvSet('locale-preference', 'es');
    mockGetProfile.mockResolvedValue({ onboarding_completed_at: null, language: null });
    mockSaveProfile.mockResolvedValueOnce({ ok: false, error: 'profile.error.network' } as never);

    const { result } = await signIn();
    await waitFor(() => {
      expect(kvGet('language-save-pending')).toBe('user-1');
    });

    await act(async () => {
      await result.current.auth.refreshProfile();
    });

    await waitFor(() => {
      expect(kvGet('language-save-pending')).toBeNull();
    });
    expect(mockSaveProfile).toHaveBeenLastCalledWith('user-1', { language: 'es' });
  });

  test('while a language save is pending, the server value does not override the newer device choice', async () => {
    // e.g. the user switched to English on Profile while offline; the server still says Spanish.
    kvSet('locale-preference', 'en');
    kvSet('language-save-pending', 'user-1');
    mockGetProfile.mockResolvedValue({ onboarding_completed_at: null, language: 'es' });

    const { result } = await signIn();

    await waitFor(() => {
      expect(mockSaveProfile).toHaveBeenCalledWith('user-1', { language: 'en' });
    });
    expect(result.current.locale.preference).toBe('en');
    await waitFor(() => {
      expect(kvGet('language-save-pending')).toBeNull();
    });
  });

  test('a pending "follow the device" choice is saved as null', async () => {
    kvSet('language-save-pending', 'user-1');
    mockGetProfile.mockResolvedValue({ onboarding_completed_at: null, language: 'es' });

    const { result } = await signIn();

    await waitFor(() => {
      expect(mockSaveProfile).toHaveBeenCalledWith('user-1', { language: null });
    });
    expect(result.current.locale.preference).toBe('system');
  });

  test("another account's pending language save is dropped, not applied", async () => {
    kvSet('language-save-pending', 'user-a');
    mockGetProfile.mockResolvedValue({ onboarding_completed_at: null, language: 'es' });

    const { result } = await signIn('user-b');

    expect(result.current.locale.preference).toBe('es');
    expect(mockSaveProfile).not.toHaveBeenCalled();
    expect(kvGet('language-save-pending')).toBeNull();
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
