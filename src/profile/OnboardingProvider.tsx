import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { completeOnboarding, getProfile, saveProfile } from './profileRepository';
import type { ProfilePatch, Result } from './profileRepository';

export type OnboardingStatus = 'loading' | 'error' | 'ready';

interface OnboardingContextValue {
  status: OnboardingStatus;
  /** The saved profile values (prefill source), merged with every successful save since. */
  values: ProfilePatch;
  reload: () => void;
  save: (patch: ProfilePatch) => Promise<Result>;
  /** Stamps onboarding as complete, then asks AuthProvider to re-read it so the guard moves on. */
  finish: () => Promise<Result>;
}

const OnboardingContext = createContext<OnboardingContextValue | undefined>(undefined);

/**
 * Holds the onboarding steps' view of the profile. Steps only render once a fresh `getProfile`
 * succeeded (`status === 'ready'`): that read is what prefills a relaunch mid-onboarding (Review
 * Focus 3), and it is also the guard for P2 binding item (a) — `AuthProvider` reports "onboarding
 * incomplete" when its own launch-time read fails, so a finished user can land here. Without a
 * successful re-read the steps would show defaults (height 165, no styles) and saving them would
 * overwrite real data, so a failed read shows a retry instead, and a profile that turns out to be
 * complete hands straight back to `AuthProvider` without rendering any step.
 */
export function OnboardingProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { userId, refreshProfile } = useAuth();
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
        // Already finished: AuthProvider's flag was stale. Re-read it there; if that read fails
        // too, fall back to the retry screen rather than a spinner with no way out.
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
        }
        return result;
      },
      finish: async () => {
        if (userId === null) {
          return { ok: false, error: 'profile.error.unknown' };
        }
        const result = await completeOnboarding(userId);
        if (result.ok) {
          await refreshProfile();
        }
        return result;
      },
    }),
    [status, values, userId, refreshProfile],
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
