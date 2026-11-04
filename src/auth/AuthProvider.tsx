import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { startAuthAutoRefresh, supabase } from '../lib/supabase';
import { getProfile } from '../profile/profileRepository';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface AuthContextValue {
  status: AuthStatus;
  userId: string | null;
  onboardingComplete: boolean;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [userId, setUserId] = useState<string | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  // Guards against a slow `getProfile` resolving after the user has signed out or switched
  // accounts, which would otherwise overwrite state with a stale profile.
  const currentUserIdRef = useRef<string | null>(null);
  // Remembers the last known onboardingComplete per user, so a `getProfile` failure falls back to
  // a previously-seen value for the *same* user (e.g. a `refreshProfile()` retry after a blip)
  // instead of always resetting to false.
  const lastKnownOnboardingRef = useRef<Map<string, boolean>>(new Map());

  async function loadProfile(nextUserId: string): Promise<void> {
    let onboarding: boolean;
    try {
      const profile = await getProfile(nextUserId);
      onboarding = profile?.onboarding_completed_at !== null && profile?.onboarding_completed_at !== undefined;
    } catch {
      // A failed profile read shouldn't leave the app stuck on a loading screen forever; fall
      // back to whatever this user's onboarding status was last known to be, or false for a user
      // never successfully loaded before.
      onboarding = lastKnownOnboardingRef.current.get(nextUserId) ?? false;
    }
    if (currentUserIdRef.current !== nextUserId) {
      return;
    }
    lastKnownOnboardingRef.current.set(nextUserId, onboarding);
    setOnboardingComplete(onboarding);
    setStatus('signedIn');
  }

  useEffect(() => {
    const stopAutoRefresh = startAuthAutoRefresh();
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const nextUserId = session?.user.id ?? null;

      if (nextUserId === null) {
        currentUserIdRef.current = null;
        setUserId(null);
        setOnboardingComplete(false);
        setStatus('signedOut');
        return;
      }

      // Ruling P2-R5: a password-recovery session is not a normal sign-in — the reset screen (and
      // its error state) must stay mounted, so status stays 'signedOut' until the user actually
      // finishes (USER_UPDATED) or a real SIGNED_IN follows.
      if (event === 'PASSWORD_RECOVERY') {
        return;
      }

      const userChanged = currentUserIdRef.current !== nextUserId;
      currentUserIdRef.current = nextUserId;
      setUserId(nextUserId);
      if (userChanged) {
        // Clear any previous user's onboarding flag immediately, so a slow `loadProfile` for the
        // new user can't leave the old user's value on screen in the meantime.
        setOnboardingComplete(false);
        setStatus('loading');
      }
      void loadProfile(nextUserId);
    });

    return () => {
      data.subscription.unsubscribe();
      stopAutoRefresh();
    };
  }, []);

  const refreshProfile = useMemo(
    () => async (): Promise<void> => {
      const activeUserId = currentUserIdRef.current;
      if (activeUserId === null) {
        return;
      }
      await loadProfile(activeUserId);
    },
    [],
  );

  const value = useMemo(
    () => ({ status, userId, onboardingComplete, refreshProfile }),
    [status, userId, onboardingComplete, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
