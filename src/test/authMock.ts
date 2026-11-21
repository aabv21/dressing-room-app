// A stand-in for `AuthProvider` in screen suites: `useAuth()` reads a store the test changes with
// `setAuth`, re-rendering like the real provider. Use with:
//
//   jest.mock('../auth/AuthProvider', () => require('../test/authMock'));
//
// `resetAuth()` (run it in `beforeEach`) signs in `user-1` with a ready, empty profile.
import { useSyncExternalStore } from 'react';

import type { AuthContextValue } from '../auth/AuthProvider';
import type { ProfilePatch } from '../profile/profileRepository';

let state: AuthContextValue;
const listeners = new Set<() => void>();

export function setAuth(patch: Partial<AuthContextValue>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function resetAuth(patch: Partial<AuthContextValue> = {}): AuthContextValue {
  state = {
    status: 'signedIn',
    userId: 'user-1',
    email: null,
    onboardingComplete: true,
    profile: {},
    profileStatus: 'ready',
    refreshProfile: jest.fn(() => Promise.resolve(true)),
    // Merges like the real provider, so a saved patch shows on the next render.
    replaceProfileLocal: jest.fn((next: ProfilePatch) => {
      if (state.profile !== null) setAuth({ profile: { ...state.profile, ...next } });
    }),
    ...patch,
  };
  for (const listener of listeners) listener();
  return state;
}
resetAuth();

/** The value `useAuth()` returns now, for assertions outside a component. */
export function currentAuth(): AuthContextValue {
  return state;
}

export function useAuth(): AuthContextValue {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => state,
  );
}

export function AuthProvider({ children }: { children?: React.ReactNode }): React.ReactNode {
  return children;
}
