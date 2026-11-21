// The whole auth surface. `emailAuth.ts` stays free of the native Apple/Google modules, so the
// integration tests, under plain Node, can import it without `socialAuth.ts`.
export type { Client, Result, SignUpResult } from './emailAuth';
export {
  confirmPasswordReset,
  requestPasswordReset,
  signInWithEmail,
  signOut,
  signOutLocally,
  signUpWithEmail,
  storedSessionUserId,
} from './emailAuth';
export { signInWithApple, signInWithGoogle } from './socialAuth';
