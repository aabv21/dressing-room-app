// Barrel re-exporting the full auth surface. Split into
// `emailAuth.ts` (node-safe: no Apple/Google imports) and `socialAuth.ts` (Apple/Google, needs
// Expo/React Native's native module registry) so integration tests — which run under plain Node,
// not jest-expo — can import only the node-safe half without pulling in modules that can't load
// outside a real app or jest-expo's mocked RN environment. See emailAuth.ts's module doc.
export type { Client, Result, SignUpResult } from './emailAuth';
export {
  confirmPasswordReset,
  requestPasswordReset,
  signInWithEmail,
  signOut,
  signUpWithEmail,
} from './emailAuth';
export { signInWithApple, signInWithGoogle } from './socialAuth';
