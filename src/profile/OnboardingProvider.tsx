import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { useAuth } from '../auth/AuthProvider';
import type { MessageKey } from '../i18n';
import { completeOnboarding, getProfile, saveProfile } from './profileRepository';
import type { ProfilePatch, Result } from './profileRepository';

export type OnboardingStatus = 'loading' | 'error' | 'ready';

interface OnboardingContextValue {
  status: OnboardingStatus;
  /** The saved profile values (prefill source), merged with every successful save since. */
  values: ProfilePatch;
  reload: () => void;
  save: (patch: ProfilePatch) => Promise<Result>;
  /**
   * Stamps completion, then has AuthProvider re-read it so the guard moves on. A failed re-read reports
   * `onboarding.error.continue` instead of leaving the user stuck (Start again is safe: idempotent).
   */
  finish: () => Promise<{ ok: true } | { ok: false; error: MessageKey }>;
}

const OnboardingContext = createContext<OnboardingContextValue | undefined>(undefined);

/**
 * Steps render only after a fresh `getProfile` succeeds: it prefills a relaunch, and a finished user
 * can land here when AuthProvider's launch read failed, so defaults must never be saved over real
 * data. A failed read offers a retry; a complete profile hands back to AuthProvider.
 */
export function OnboardingProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { userId, refreshProfile, replaceProfileLocal } = useAuth();
  const [status, setStatus] = useState<OnboardingStatus>('loading');
  const [values, setValues] = useState<ProfilePatch>({});
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (userId === null) {
      return undefined;
    }
    const controller = new AbortController();
    // A function, not a `signal.aborted` read, so TypeScript doesn't narrow it across the awaits.
    const isCurrent = (): boolean => !controller.signal.aborted;
    void (async () => {
      let profile: Awaited<ReturnType<typeof getProfile>>;
      try {
        profile = await getProfile(userId);
      } catch {
        if (isCurrent()) {
          setStatus('error');
        }
        return;
      }
      if (!isCurrent()) {
        return;
      }
      if (profile !== null && profile.onboarding_completed_at !== null) {
        // AuthProvider's flag was stale: re-read it there; if that fails too, show the retry screen.
        await refreshProfile();
        if (isCurrent()) {
          setStatus('error');
        }
        return;
      }
      setValues(profile ?? {});
      setStatus('ready');
    })();
    return () => {
      controller.abort();
    };
  }, [userId, attempt, refreshProfile]);

  const value = useMemo<OnboardingContextValue>(
    () => ({
      status,
      values,
      reload: () => {
        setStatus('loading');
        setAttempt((previous) => previous + 1);
      },
      save: async (patch) => {
        if (userId === null) {
          return { ok: false, error: 'profile.error.unknown' };
        }
        const result = await saveProfile(userId, patch);
        if (result.ok) {
          setValues((previous) => ({ ...previous, ...patch }));
          replaceProfileLocal(patch);
        }
        return result;
      },
      finish: async () => {
        if (userId === null) {
          return { ok: false, error: 'profile.error.unknown' };
        }
        const result = await completeOnboarding(userId);
        if (!result.ok) {
          return result;
        }
        const refreshed = await refreshProfile();
        return refreshed ? { ok: true } : { ok: false, error: 'onboarding.error.continue' };
      },
    }),
    [status, values, userId, refreshProfile, replaceProfileLocal],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingContextValue {
  const context = useContext(OnboardingContext);
  if (context === undefined) {
    throw new Error('useOnboarding must be used within an OnboardingProvider');
  }
  return context;
}
