import { useEffect, useState } from 'react';
import { View } from 'react-native';

// Reanimated 4's own `react-native-reanimated/mock` re-exports its real `./index`, which at
// module scope reaches into `react-native-worklets`' native TurboModule and crashes under
// jest-expo (same class of problem as FlashList's native binding — see `flashListMock.tsx`'s
// module doc). Reanimated's packaged Jest *resolver* fix (`react-native-reanimated/jest/resolver.js`)
// needs Jest's legacy default resolver and destabilizes unrelated `.ios.tsx` resolution under
// Jest 30's `unrs-resolver` default (verified: wiring it broke `expo-glass-effect`'s screen
// resolution across the whole suite). This hand-rolled stand-in instead implements only the
// surface the app's chart components use, modeling the real on-device split between the UI
// thread (shared values) and the JS/React thread (everything that re-renders):
//
// - `useSharedValue`: a mutable box whose `.value` writes are invisible to a plain render — a
//   component that reads `.value` straight into a style object only ever sees the value from
//   its own render pass, never a later mutation, exactly like reanimated's real shared values
//   (UI-thread state that never triggers a React re-render on write — see `mutablesCommon.js`).
//   This is deliberate: it's what makes this mock able to catch C1 (see task-4-report.md), where
//   a component did exactly that and froze every bar at 0% on a real device. Internally each
//   box also keeps a tiny listener set so `useAnimatedStyle` (below) can re-render when the
//   value it's reading changes — there is no UI thread here to push the update straight to a
//   native view, so a React re-render is the only way this mock can make a later write visible
//   at all, and only through `useAnimatedStyle`, never through a plain style read.
// - `useAnimatedStyle`: takes an explicit `deps` array (reanimated's own documented fallback for
//   when its Babel plugin can't statically detect which shared values a worklet reads — there's
//   no worklet runtime under Jest, so this mock always needs it) and re-renders whenever one of
//   them changes, re-invoking the factory with the latest values. On a device, reanimated's real
//   `useAnimatedStyle` instead runs the worklet on the UI thread and pushes the result to the
//   native view directly, bypassing React — this mock's re-render is the nearest JS-only
//   equivalent of "the latest value becomes visible without the owning component re-rendering
//   for any other reason". The caller must call this hook before any effect in the same
//   component that writes to one of `deps` (`HorizontalBars.tsx`'s `Bar` does), since React runs
//   same-component effects in hook-declaration order and a write that fires before this
//   subscribes would otherwise be missed.
// - `withTiming`: returns the target value synchronously (matching reanimated's own mock
//   behavior for `withTiming` — see `react-native-reanimated/mock`'s module doc) — there is no
//   animation driver under Jest, so a timing animation settles instantly rather than over time.
// - `useReducedMotion`: defaults to `false`.
//
// Use with: `jest.mock('react-native-reanimated', () => require('<relative path to>/test/reanimatedMock'));`
// (the path depth depends on the test file's own location, as with `flashListMock.tsx` above).
export function useReducedMotion(): boolean {
  return false;
}

type Listener = () => void;
type SharedValueBox<T> = { value: T; _listeners: Set<Listener> };

export function useSharedValue<T>(initial: T): { value: T } {
  const [box] = useState<SharedValueBox<T>>(() => {
    const listeners = new Set<Listener>();
    let current = initial;
    return {
      _listeners: listeners,
      get value() {
        return current;
      },
      set value(next: T) {
        current = next;
        for (const listener of listeners) {
          listener();
        }
      },
    };
  });
  return box;
}

export function useAnimatedStyle<T>(factory: () => T, deps?: readonly unknown[]): T {
  const [, forceRender] = useState(0);
  const boxes = (deps ?? []).filter(
    (dep): dep is SharedValueBox<unknown> =>
      typeof dep === 'object' && dep !== null && '_listeners' in dep,
  );

  // Subscribes once per box identity (`deps` is expected to list the shared values the factory
  // reads, same as reanimated's own fallback API). The caller must declare this hook before any
  // effect that writes to one of `deps` in the same component (`HorizontalBars.tsx`'s `Bar`
  // does), so this effect's subscription is in place before that write fires — React runs
  // same-component effects in hook-declaration order.
  useEffect(() => {
    const onChange = () => {
      forceRender((tick) => tick + 1);
    };
    for (const box of boxes) {
      box._listeners.add(onChange);
    }
    return () => {
      for (const box of boxes) {
        box._listeners.delete(onChange);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, boxes);

  return factory();
}

export function withTiming<T>(toValue: T): T {
  return toValue;
}

export default { View };
