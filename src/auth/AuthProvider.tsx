import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { forgetInterruptedDeletions } from '../account/deletionMarker';
import { useLocalePreference } from '../i18n/I18nProvider';
import type { LocalePreference } from '../i18n/I18nProvider';
import { readStoredSession, startAuthAutoRefresh, supabase } from '../lib/supabase';
import { getProfile, saveProfile } from '../profile/profileRepository';
import type { Profile } from '../profile/profileRepository';
import {
  cacheOnboarding,
  cachedOnboarding,
  clearCachedOnboarding,
  clearLanguageSavePending,
  forgetOtherAccounts,
  isLanguageSavePending,
  markLanguageSavePending,
} from './deviceState';

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

function languageFor(preference: LocalePreference): 'en' | 'es' | null {
  return preference === 'system' ? null : preference;
}

/** Saves the device's language choice to the profile, remembering a failure for a later retry. */
function saveDeviceLanguage(userId: string, preference: LocalePreference): void {
  void saveProfile(userId, { language: languageFor(preference) }).then((result) => {
    if (result.ok) {
      clearLanguageSavePending(userId);
    } else {
      markLanguageSavePending(userId);
    }
  });
}

type LocaleControl = { preference: LocalePreference; setPreference: (next: LocalePreference) => void };

/**
 * After a successful profile read: a saved `profile.language` becomes this device's preference
 * (once per sign-in, so later re-reads never override a newer local choice); with none saved, an
 * explicit device choice (e.g. Welcome's toggle) is saved to the profile. A choice that failed to
 * save earlier (offline) is newer than the server's value, so it is retried instead of replaced.
 */
function syncLanguage(
  userId: string,
  saved: 'en' | 'es' | null,
  { preference, setPreference }: LocaleControl,
  syncedFor: { current: string | null },
): void {
  if (isLanguageSavePending(userId)) {
    syncedFor.current = userId;
    if (saved === languageFor(preference)) {
      clearLanguageSavePending(userId);
    } else {
      saveDeviceLanguage(userId, preference);
    }
    return;
  }
  if (syncedFor.current === userId) {
    return;
  }
  syncedFor.current = userId;
  if (saved !== null && saved !== preference) {
    setPreference(saved);
  } else if (saved === null && preference !== 'system') {
    saveDeviceLanguage(userId, preference);
  }
}

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  // Guards against a slow `getProfile` resolving after the user has signed out or switched
  // accounts, which would otherwise overwrite state with a stale profile.
  const currentUserIdRef = useRef<string | null>(null);
  // True while the session comes from storage alone (see the INITIAL_SESSION branch below) and
  // supabase-js hasn't yet confirmed it with a refreshed token.
  const unconfirmedSessionRef = useRef(false);
  // The language preference lives on the device (I18nProvider) and in `profile.language`. They are
  // reconciled once per sign-in; refs because the auth listener below is subscribed once.
  const locale = useLocalePreference();
  const localeRef = useRef<LocaleControl>(locale);
  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);
  const languageSyncedForRef = useRef<string | null>(null);

  async function loadProfile(nextUserId: string): Promise<boolean> {
    let profile: Profile | null | undefined;
    try {
      profile = await getProfile(nextUserId);
    } catch {
      profile = undefined;
    }
    // The signup trigger creates every account's row, so finding none while the session is still
    // unconfirmed means the request went out without a valid token (RLS hid the row), not that
    // onboarding is incomplete: it counts as a failed read.
    const loaded = profile !== undefined && !(profile === null && unconfirmedSessionRef.current);
    if (currentUserIdRef.current !== nextUserId) {
      return false;
    }
    let onboarding: boolean;
    if (loaded) {
      onboarding = profile?.onboarding_completed_at !== null && profile?.onboarding_completed_at !== undefined;
      cacheOnboarding(nextUserId, onboarding);
      syncLanguage(nextUserId, profile?.language ?? null, localeRef.current, languageSyncedForRef);
    } else {
      // A failed read (e.g. offline) must not leave the app stuck on a loading screen, nor send a
      // finished user back into onboarding: fall back to this account's last known status on this
      // device, or false for an account never loaded here.
      onboarding = cachedOnboarding(nextUserId) ?? false;
    }
    setOnboardingComplete(onboarding);
    setStatus('signedIn');
    return loaded;
  }

  useEffect(() => {
    const stopAutoRefresh = startAuthAutoRefresh();
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      let nextUserId = session?.user.id ?? null;
      let nextEmail = session?.user.email ?? null;
      // Offline launch: when an expired access token can't be refreshed for lack of network,
      // supabase-js reports INITIAL_SESSION as null but keeps the session stored and keeps retrying
      // the refresh. Its user stays signed in meanwhile; a later TOKEN_REFRESHED confirms the
      // session, and a rejected refresh token removes it and emits SIGNED_OUT.
      const restored = nextUserId === null && event === 'INITIAL_SESSION' ? readStoredSession() : null;
      if (restored !== null) {
        nextUserId = restored.userId;
        nextEmail = restored.email;
      }

      if (nextUserId === null) {
        // An account whose deletion was under way when its session ended (supabase-js signs out
        // by itself once the account is gone) leaves no kv data on the device. Best effort: a
        // storage error must never keep the app from reaching the signed-out state.
        try {
          forgetInterruptedDeletions(null);
        } catch {
          // Retried at the next sign-out or sign-in.
        }
        currentUserIdRef.current = null;
        unconfirmedSessionRef.current = false;
        languageSyncedForRef.current = null;
        clearCachedOnboarding();
        setUserId(null);
        setEmail(null);
        setOnboardingComplete(false);
        setStatus('signedOut');
        return;
      }

      // A password-recovery session is not a normal sign-in: the reset screen (and its error
      // state) must stay mounted, so status stays 'signedOut' until the user actually finishes
      // (USER_UPDATED) or a real SIGNED_IN follows.
      if (event === 'PASSWORD_RECOVERY') {
        return;
      }

      unconfirmedSessionRef.current = restored !== null;
      const userChanged = currentUserIdRef.current !== nextUserId;
      currentUserIdRef.current = nextUserId;
      setUserId(nextUserId);
      setEmail(nextEmail);
      if (userChanged) {
        forgetOtherAccounts(nextUserId);
        try {
          forgetInterruptedDeletions(nextUserId);
        } catch {
          // Best effort, as on sign-out: retried at the next sign-out or sign-in.
        }
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
