import { useCallback, useState } from 'react';

import { forgetDisplayCaches } from '../account/forgetAccount';
import { useI18n } from '../i18n';
import { announceForAccessibility } from '../ui/a11y';
import { useAuth } from './AuthProvider';
import { signOut } from './authService';
import type { AuthErrorKey } from './errors';

/**
 * Sign-out for a button or link: tracks the pending request and keeps a failure's message key so
 * the screen can show it (a successful sign-out needs nothing here — AuthProvider's SIGNED_OUT
 * moves the guard to the welcome screen).
 */
export function useSignOut(): { signOut: () => void; signingOut: boolean; error: AuthErrorKey | undefined } {
  const { t } = useI18n();
  const { userId } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<AuthErrorKey | undefined>(undefined);

  const run = useCallback(() => {
    setError(undefined);
    setSigningOut(true);
    void signOut().then((result) => {
      setSigningOut(false);
      if (result.ok && userId !== null) forgetDisplayCaches(userId);
      if (!result.ok) {
        setError(result.error);
        announceForAccessibility(t(result.error));
      }
    });
  }, [t, userId]);

  return { signOut: run, signingOut, error };
}
