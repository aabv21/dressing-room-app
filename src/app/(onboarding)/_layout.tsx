import { Stack } from 'expo-router';

// NOTE: placeholder onboarding group so the root layout's Stack.Protected guard (src/app/_layout.tsx)
// has a real route to point to before Task 6 exists. Ceiling: a single empty screen, no steps.
// Upgrade path: Task 6 replaces this file and `index.tsx` with the real step flow
// (clothing/body/style) per the plan.
export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}
