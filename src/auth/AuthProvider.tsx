import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useLocalePreference } from '../i18n/I18nProvider';
import type { LocalePreference } from '../i18n/I18nProvider';
import { startAuthAutoRefresh, supabase } from '../lib/supabase';
import { getProfile, saveProfile } from '../profile/profileRepository';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface AuthContextValue {
  status: AuthStatus;
  userId: string | null;
  /** The signed-in account's email (null when signed out, or for a provider that shares none). */
  email: string | null;
  onboardingComplete: boolean;
  /** Re-reads the profile; resolves false when that read failed (the last known flag is kept). */
  refreshProfile: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  // Guards against a slow `getProfile` resolving after the user has signed out or switched
  // accounts, which would otherwise overwrite state with a stale profile.
  const currentUserIdRef = useRef<string | null>(null);
  // Remembers the last known onboardingComplete per user, so a `getProfile` failure falls back to
  // a previously-seen value for the *same* user (e.g. a `refreshProfile()` retry after a blip)
  // instead of always resetting to false.
  const lastKnownOnboardingRef = useRef<Map<string, boolean>>(new Map());
  // The language preference lives on the device (I18nProvider) and in `profile.language`. They are
  // reconciled once per sign-in (P2-R13); refs because the auth listener below is subscribed once.
  const locale = useLocalePreference();
  const localeRef = useRef<{ preference: LocalePreference; setPreference: (next: LocalePreference) => void }>(locale);
  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);
  const languageSyncedForRef = useRef<string | null>(null);

  async function loadProfile(nextUserId: string): Promise<boolean> {
    let onboarding: boolean;
    let loaded = true;
    let language: 'en' | 'es' | null = null;
    try {
      const profile = await getProfile(nextUserId);
      onboarding = profile?.onboarding_completed_at !== null && profile?.onboarding_completed_at !== undefined;
      language = profile?.language ?? null;
    } catch {
      loaded = false;
      // A failed profile read shouldn't leave the app stuck on a loading screen forever; fall
      // back to whatever this user's onboarding status was last known to be, or false for a user
      // never successfully loaded before.
      onboarding = lastKnownOnboardingRef.current.get(nextUserId) ?? false;
    }
    if (currentUserIdRef.current !== nextUserId) {
      return false;
    }
    // On the first successful read after a sign-in (or a launch with a session), reconcile the
    // language: a saved `profile.language` becomes this device's preference; with none saved, an
    // explicit device choice (e.g. Welcome's toggle) is saved to the profile (best effort — the
    // next sign-in tries again). Later re-reads never override a newer local choice.
    if (loaded && languageSyncedForRef.current !== nextUserId) {
      languageSyncedForRef.current = nextUserId;
      const { preference, setPreference } = localeRef.current;
      if (language !== null && language !== preference) {
        setPreference(language);
      } else if (language === null && preference !== 'system') {
        void saveProfile(nextUserId, { language: preference });
      }
    }
    lastKnownOnboardingRef.current.set(nextUserId, onboarding);
    setOnboardingComplete(onboarding);
    setStatus('signedIn');
    return loaded;
  }

  useEffect(() => {
    const stopAutoRefresh = startAuthAutoRefresh();
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const nextUserId = session?.user.id ?? null;

      if (nextUserId === null) {
        currentUserIdRef.current = null;
        languageSyncedForRef.current = null;
        setUserId(null);
        setEmail(null);
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
      setEmail(session?.user.email ?? null);
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
    () => async (): Promise<boolean> => {
      const activeUserId = currentUserIdRef.current;
      if (activeUserId === null) {
        return false;
      }
      return loadProfile(activeUserId);
    },
    [],
  );

  const value = useMemo(
    () => ({ status, userId, email, onboardingComplete, refreshProfile }),
    [status, userId, email, onboardingComplete, refreshProfile],
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
