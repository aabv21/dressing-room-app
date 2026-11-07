import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AuthProvider, useAuth } from '../auth/AuthProvider';
import { I18nProvider } from '../i18n/I18nProvider';
import { OnboardingArrivalContext } from '../ui/onboardingArrival';
import { colors } from '../ui/theme';

// Keeps the native splash screen up while `AuthProvider`'s first `onAuthStateChange` event (and,
// for a signed-in user, its profile load) is still pending, so the app never flashes an
// intermediate route before the guards below know which group to show.
void SplashScreen.preventAutoHideAsync();

type Settled = { status: 'signedOut' | 'signedIn'; onboardingComplete: boolean; userId: string | null };

/**
 * `status` returns to `'loading'` on every user change, not just the app's first launch (see
 * `AuthProvider`'s `userChanged` branch) — e.g. the moment `signInWithEmail` succeeds and GoTrue's
 * session lands, before `loadProfile` resolves. Returning `null` for every `'loading'` would
 * unmount the entire navigator on each sign-in, blanking the screen the user was just looking at
 * mid-request. Only the *first* settle (before anything has ever rendered) hides behind `null` +
 * the native splash; every `'loading'` after that keeps rendering the *last settled* guard
 * combination (so `(auth)` or `(onboarding)`/`(tabs)` stays mounted, not a blank `<Stack>` with
 * every `Stack.Protected` false) and overlays a small busy indicator.
 *
 * Finishing onboarding (the same account going from incomplete to complete) lands on the Closet,
 * where the first goal is adding favorites; every other way into the tabs opens on Today.
 *
 * `lastSettled` is `useState`, not a ref: it's read during render to decide what to show, and a
 * ref's `.current` may not reflect the value actually committed for this render (React's
 * react-hooks/refs rule flags exactly that read-during-render pattern). Setting state during
 * render like this is React's own sanctioned way to derive state from a prop/context change
 * without an extra render round-trip — see https://react.dev/reference/react/useState#storing-information-from-previous-renders.
 */
function Guards() {
  const { status, userId, onboardingComplete } = useAuth();
  const [lastSettled, setLastSettled] = useState<Settled | null>(null);
  const [arrivalPending, setArrivalPending] = useState(false);
  const settleArrival = useCallback(() => {
    setArrivalPending(false);
  }, []);
  const arrival = useMemo(() => ({ pending: arrivalPending, settle: settleArrival }), [arrivalPending, settleArrival]);

  if (
    status !== 'loading' &&
    (lastSettled === null ||
      lastSettled.status !== status ||
      lastSettled.onboardingComplete !== onboardingComplete ||
      lastSettled.userId !== userId)
  ) {
    const finishedOnboarding =
      lastSettled !== null &&
      lastSettled.status === 'signedIn' &&
      !lastSettled.onboardingComplete &&
      lastSettled.userId === userId &&
      status === 'signedIn' &&
      onboardingComplete;
    setArrivalPending(finishedOnboarding);
    setLastSettled({ status, onboardingComplete, userId });
  }

  useEffect(() => {
    if (status !== 'loading') {
      void SplashScreen.hideAsync();
    }
  }, [status]);

  let active: Settled;
  if (status === 'signedOut' || status === 'signedIn') {
    active = { status, onboardingComplete, userId };
  } else if (lastSettled !== null) {
    active = lastSettled;
  } else {
    // First-ever render, still loading: nothing has settled yet, so there's no guard tree to
    // show — the native splash screen stays up instead (see the module-level `preventAutoHideAsync`).
    return null;
  }

  return (
    <OnboardingArrivalContext.Provider value={arrival}>
      <View style={styles.fill}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={active.status === 'signedOut'}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
          <Stack.Protected guard={active.status === 'signedIn' && !active.onboardingComplete}>
            <Stack.Screen name="(onboarding)" />
          </Stack.Protected>
          <Stack.Protected guard={active.status === 'signedIn' && active.onboardingComplete}>
            <Stack.Screen name="(tabs)" />
          </Stack.Protected>
        </Stack>
        {status === 'loading' ? (
          <View style={styles.busyOverlay} pointerEvents="none" testID="auth-busy-overlay">
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : null}
      </View>
    </OnboardingArrivalContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  busyOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingTop: 12,
  },
});

export default function RootLayout() {
  return (
    <I18nProvider>
      <AuthProvider>
        <Guards />
      </AuthProvider>
    </I18nProvider>
  );
}
