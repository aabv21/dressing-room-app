import { View } from 'react-native';

// Reanimated 4's own `react-native-reanimated/mock` re-exports its real `./index`, which at
// module scope reaches into `react-native-worklets`' native TurboModule and crashes under
// jest-expo (same class of problem as FlashList's native binding — see `flashListMock.tsx`'s
// module doc). Reanimated's packaged Jest *resolver* fix (`react-native-reanimated/jest/resolver.js`)
// needs Jest's legacy default resolver and destabilizes unrelated `.ios.tsx` resolution under
// Jest 30's `unrs-resolver` default (verified: wiring it broke `expo-glass-effect`'s screen
// resolution across the whole suite). This hand-rolled stand-in instead implements only the
// surface the app's chart components use: shared values settle synchronously to their target
// (no native UI-thread animation driver under test), and `useReducedMotion` defaults to `false`.
//
// Use with: `jest.mock('react-native-reanimated', () => require('<relative path to>/test/reanimatedMock'));`
// (the path depth depends on the test file's own location, as with `flashListMock.tsx` above).
export function useReducedMotion(): boolean {
  return false;
}

export function useSharedValue<T>(initial: T): { value: T } {
  // A plain mutable box: React Native Testing Library's `render`/`fireEvent` already run inside
  // `act()`, and this repo's components read `.value` straight into JSX (no `useAnimatedStyle`
  // worklet), so a plain object without the real UI-thread/JS-thread bridging is enough to
  // observe the settled value in a render.
  return { value: initial };
}

export function withTiming<T>(toValue: T): T {
  // No animation driver under test: jump straight to the end value, matching reanimated's own
  // mock behavior for `withTiming` (see `react-native-reanimated/mock`'s module doc).
  return toValue;
}

export default { View };
