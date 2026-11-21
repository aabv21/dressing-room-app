import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AuthProvider, useAuth } from '../auth/AuthProvider';
import { ClosetProvider } from '../closet/ClosetProvider';
import { UploadQueueProvider } from '../closet/UploadQueueProvider';
import { WearQueueFlusher } from '../outfits/WearQueueFlusher';
import { I18nProvider } from '../i18n/I18nProvider';
import { quietDevToastsForE2e } from '../lib/e2eLaunch';
import { presentRemindersInForeground } from '../reminder/dailyReminder';
import { DailyReminderSync } from '../reminder/DailyReminderSync';
import { OnboardingArrivalContext } from '../ui/onboardingArrival';
import { colors } from '../ui/theme';

// The splash stays up until `AuthProvider` first settles (auth event, then the profile when signed
// in), so no intermediate route flashes before the guards know which group to show.
void SplashScreen.preventAutoHideAsync();
quietDevToastsForE2e();
presentRemindersInForeground();

type Settled = { status: 'signedOut' | 'signedIn'; onboardingComplete: boolean; userId: string | null };

// `status` goes back to `'loading'` on every user change (e.g. right after sign-in, before the profile
// loads); unmounting the navigator then would blank the screen mid-request, so only the first load
// renders `null` (behind the splash) and later ones keep the last settled guards under a busy overlay.
// Finishing onboarding lands on the Closet (first goal: favorites); every other way in opens on Today.
// `lastSettled` is state set during render, not a ref: it's read during render (react-hooks/refs).
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
    // First-ever load: no guards have settled yet, so the splash stays up.
    return null;
  }

  const stack = (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={active.status === 'signedOut'}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={active.status === 'signedIn' && !active.onboardingComplete}>
        <Stack.Screen name="(onboarding)" />
      </Stack.Protected>
      <Stack.Protected guard={active.status === 'signedIn' && active.onboardingComplete}>
        <Stack.Screen name="(tabs)" />
        {/* Closet screens without the tab bar. The camera is a full-screen modal; review and the
            garment detail are plain pushes, so the back gesture returns to the closet. */}
        <Stack.Screen name="camera" options={{ presentation: 'fullScreenModal' }} />
        <Stack.Screen name="review" />
        <Stack.Screen name="garment/[id]" />
        {/* The rating, pushed from Today and Build with the outfit's garment ids. */}
        <Stack.Screen name="rate" />
        {/* Today's city: a sheet over the tabs, so closing it lands back on Today. */}
        <Stack.Screen name="city" options={{ presentation: 'modal' }} />
      </Stack.Protected>
    </Stack>
  );

  return (
    <OnboardingArrivalContext.Provider value={arrival}>
      <View style={styles.fill}>
        {/* Dark icons on the light screens; Android's edge-to-edge default is light icons. */}
        <StatusBar style="dark" />
        {active.status === 'signedIn' && active.userId !== null ? (
          // Keyed by user: another account never sees the previous one's closet or upload queue.
          <ClosetProvider key={active.userId}>
            <UploadQueueProvider>{stack}</UploadQueueProvider>
            <WearQueueFlusher />
            {active.onboardingComplete ? <DailyReminderSync /> : null}
          </ClosetProvider>
        ) : (
          stack
        )}
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
