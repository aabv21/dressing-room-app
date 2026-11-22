import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { forgetInterruptedDeletions } from '../account/deletionMarker';
import { useLocalePreference } from '../i18n/I18nProvider';
import type { LocalePreference } from '../i18n/I18nProvider';
import { allowUserKeys } from '../lib/kv';
import { useOnResume } from '../lib/useOnResume';
import { readStoredSession, startAuthAutoRefresh, supabase } from '../lib/supabase';
import { getProfile, saveProfile } from '../profile/profileRepository';
import type { Profile, ProfilePatch } from '../profile/profileRepository';
import { flushPendingUnregister } from '../push/pushRegistration';
import { turnOffReminder } from '../reminder/dailyReminder';
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
/** `ready` once a read succeeded for this account; `error` when none has yet. */
export type ProfileStatus = 'loading' | 'ready' | 'error';

export interface AuthContextValue {
  status: AuthStatus;
  userId: string | null;
  /** The signed-in account's email (null when signed out, or for a provider that shares none). */
  email: string | null;
  onboardingComplete: boolean;
  /** The signed-in account's profile as last read (no row reads as `{}`); null until one succeeds. */
  profile: ProfilePatch | null;
  profileStatus: ProfileStatus;
  /** Re-reads the profile; resolves false when that read failed (the last known values are kept). */
  refreshProfile: () => Promise<boolean>;
  /** Merges a patch a screen just saved, so every screen shows it without another read. */
  replaceProfileLocal: (patch: ProfilePatch) => void;
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
 * A saved `profile.language` becomes the device's preference once per sign-in (so a re-read never
 * overrides a newer local choice); with none saved, an explicit device choice is saved. A choice that
 * failed to save offline is newer than the server's, so it is retried instead of replaced.
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
  const [profile, setProfile] = useState<ProfilePatch | null>(null);
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>('loading');
  // Drops a slow `getProfile` that resolves after a sign-out or an account switch.
  const currentUserIdRef = useRef<string | null>(null);
  // True while the session comes from storage alone (INITIAL_SESSION below), not yet refreshed.
  const unconfirmedSessionRef = useRef(false);
  // Device and profile languages are reconciled once per sign-in; refs since the listener subscribes once.
  const locale = useLocalePreference();
  const localeRef = useRef<LocaleControl>(locale);
  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);
  const languageSyncedForRef = useRef<string | null>(null);
  // The account whose profile read last succeeded: a token refresh doesn't need to read it again.
  const profileLoadedForRef = useRef<string | null>(null);

  async function loadProfile(nextUserId: string): Promise<boolean> {
    let row: Profile | null | undefined;
    try {
      row = await getProfile(nextUserId);
    } catch {
      row = undefined;
    }
    // Every account has a row (signup trigger), so none under an unconfirmed session means RLS hid it
    // for lack of a valid token: a failed read, not unfinished onboarding.
    const loaded = row !== undefined && !(row === null && unconfirmedSessionRef.current);
    if (currentUserIdRef.current !== nextUserId) {
      return false;
    }
    let onboarding: boolean;
    if (loaded) {
      profileLoadedForRef.current = nextUserId;
      onboarding = row?.onboarding_completed_at !== null && row?.onboarding_completed_at !== undefined;
      cacheOnboarding(nextUserId, onboarding);
      syncLanguage(nextUserId, row?.language ?? null, localeRef.current, languageSyncedForRef);
      setProfile(row ?? {});
      setProfileStatus('ready');
    } else {
      // A failed read (e.g. offline) must neither stall on loading nor send a finished user back to
      // onboarding: use this device's last known status for the account.
      onboarding = cachedOnboarding(nextUserId) ?? false;
      // A failed re-read keeps the profile already shown.
      setProfileStatus((previous) => (previous === 'ready' ? previous : 'error'));
    }
    setOnboardingComplete(onboarding);
    setStatus('signedIn');
    return loaded;
  }

  useEffect(() => {
    // A sign-out that couldn't reach the server left its push token pending; retry at launch.
    void flushPendingUnregister();
    const stopAutoRefresh = startAuthAutoRefresh();
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      let nextUserId = session?.user.id ?? null;
      let nextEmail = session?.user.email ?? null;
      // Offline launch: with an expired token supabase-js reports INITIAL_SESSION as null but keeps the
      // session and retries; the user stays signed in until TOKEN_REFRESHED or SIGNED_OUT.
      const restored = nextUserId === null && event === 'INITIAL_SESSION' ? readStoredSession() : null;
      if (restored !== null) {
        nextUserId = restored.userId;
        nextEmail = restored.email;
      }

      if (nextUserId === null) {
        // A session that ended mid-deletion (supabase-js signs out once the account is gone) leaves
        // no kv data. Best effort: a storage error must never block the signed-out state.
        try {
          forgetInterruptedDeletions(null);
        } catch {
          // Retried at the next sign-out or sign-in.
        }
        // Whoever uses the phone next mustn't get this account's reminder.
        if (currentUserIdRef.current !== null) void turnOffReminder(currentUserIdRef.current);
        currentUserIdRef.current = null;
        unconfirmedSessionRef.current = false;
        languageSyncedForRef.current = null;
        profileLoadedForRef.current = null;
        clearCachedOnboarding();
        setUserId(null);
        setEmail(null);
        setOnboardingComplete(false);
        setProfile(null);
        setProfileStatus('loading');
        setStatus('signedOut');
        return;
      }

      // A recovery session isn't a sign-in: the reset screen must stay mounted, so status stays
      // 'signedOut' until USER_UPDATED or a real SIGNED_IN.
      if (event === 'PASSWORD_RECOVERY') {
        return;
      }

      unconfirmedSessionRef.current = restored !== null;
      const userChanged = currentUserIdRef.current !== nextUserId;
      currentUserIdRef.current = nextUserId;
      setUserId(nextUserId);
      setEmail(nextEmail);
      if (userChanged) {
        // A session proves the account still exists, so its kv writes are allowed again.
        allowUserKeys(nextUserId);
        forgetOtherAccounts(nextUserId);
        void flushPendingUnregister();
        try {
          forgetInterruptedDeletions(nextUserId);
        } catch {
          // Best effort, as on sign-out: retried at the next sign-out or sign-in.
        }
        // Clear the previous user's state now so a slow `loadProfile` can't leave it on screen.
        setOnboardingComplete(false);
        setProfile(null);
        setProfileStatus('loading');
        setStatus('loading');
      }
      // A refresh skips the read, unless the profile never loaded (an offline launch reconnecting).
      if (event === 'TOKEN_REFRESHED' && !userChanged && profileLoadedForRef.current === nextUserId) {
        return;
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
      setProfileStatus((previous) => (previous === 'error' ? 'loading' : previous));
      return loadProfile(activeUserId);
    },
    [],
  );

  // A launch read that failed offline would otherwise wait for the next token refresh (up to an hour).
  const profileStatusRef = useRef(profileStatus);
  useEffect(() => {
    profileStatusRef.current = profileStatus;
  });
  useOnResume(() => {
    if (profileStatusRef.current === 'error') void refreshProfile();
  });

  const replaceProfileLocal = useCallback((patch: ProfilePatch) => {
    setProfile((previous) => (previous === null ? previous : { ...previous, ...patch }));
  }, []);

  const value = useMemo(
    () => ({ status, userId, email, onboardingComplete, profile, profileStatus, refreshProfile, replaceProfileLocal }),
    [status, userId, email, onboardingComplete, profile, profileStatus, refreshProfile, replaceProfileLocal],
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
