import { Stack } from 'expo-router';

import { I18nProvider } from '../i18n/I18nProvider';

export default function RootLayout() {
  return (
    <I18nProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
      </Stack>
    </I18nProvider>
  );
}
