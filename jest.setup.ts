import { Dimensions } from 'react-native';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- jest.mock()'s factory can only reference globals (incl. `require`), not a module-scoped import; see https://jestjs.io/docs/jest-object#jestmockmodulename-factory-options
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US', currencyCode: 'USD' }],
}));
// expo-network's native module is absent under Jest: online by default; a suite that tests
// connectivity mocks the module itself.
jest.mock('expo-network', () => ({
  useNetworkState: () => ({ isConnected: true, isInternetReachable: true }),
  addNetworkStateListener: () => ({ remove: () => undefined }),
  getNetworkStateAsync: () => Promise.resolve({ isConnected: true, isInternetReachable: true }),
}));
// react-native-view-shot's native capture is absent under Jest: a capture answers a fixed PNG file.
jest.mock('react-native-view-shot', () => ({
  captureRef: jest.fn(() => Promise.resolve('file:///cache/outfit.png')),
  releaseCapture: jest.fn(),
}));
// expo-notifications' native module is absent under Jest: permission granted, scheduling answers an
// id, no tap response; a suite that tests the reminder sets these with `jest.mocked`.
jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DAILY: 'daily' },
  IosAuthorizationStatus: { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 },
  AndroidImportance: { DEFAULT: 5 },
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true, canAskAgain: true, status: 'granted' })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true, canAskAgain: true, status: 'granted' })),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve(null)),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('reminder-id')),
  cancelScheduledNotificationAsync: jest.fn(() => Promise.resolve()),
  getAllScheduledNotificationsAsync: jest.fn(() => Promise.resolve([])),
  setNotificationHandler: jest.fn(),
  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));
// expo-speech's native module is absent under Jest: an English and a Mexican Spanish voice; a suite
// that tests speaking sets these with `jest.mocked`.
jest.mock('expo-speech', () => ({
  VoiceQuality: { Default: 'Default', Enhanced: 'Enhanced' },
  getAvailableVoicesAsync: jest.fn(() =>
    Promise.resolve([
      { identifier: 'voice-en-us', name: 'Samantha', language: 'en-US', quality: 'Default' },
      { identifier: 'voice-es-mx', name: 'Paulina', language: 'es-MX', quality: 'Default' },
    ]),
  ),
  speak: jest.fn(),
  stop: jest.fn(() => Promise.resolve()),
}));
// expo-speech-recognition's native module is absent under Jest: available, on-device, permission
// granted; `src/test/dictation.ts` emits its events.
jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    isRecognitionAvailable: jest.fn(() => true),
    supportsOnDeviceRecognition: jest.fn(() => true),
    requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true, canAskAgain: true, status: 'granted', expires: 'never' })),
    start: jest.fn(),
    stop: jest.fn(),
    abort: jest.fn(),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy', Soft: 'soft', Rigid: 'rigid' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

// `expo-sqlite/kv-store` wraps a native SQLite database; under Jest there is no native module to
// back it, so replace it with a plain in-memory map that implements the same synchronous methods
// `src/lib/kv.ts` calls (`getItemSync`/`setItemSync`/`removeItemSync`/`getAllKeysSync`).
jest.mock('expo-sqlite/kv-store', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItemSync: (key: string): string | null => store.get(key) ?? null,
      setItemSync: (key: string, value: string): void => {
        store.set(key, value);
      },
      removeItemSync: (key: string): void => {
        store.delete(key);
      },
      getAllKeysSync: (): string[] => [...store.keys()],
    },
  };
});

// React Native's Jest preset reports a font scale of 2, so every suite would render the large-text
// layouts; default to the standard text size and let a large-text test mock it explicitly.
Dimensions.set({
  window: { ...Dimensions.get('window'), fontScale: 1 },
  screen: { ...Dimensions.get('screen'), fontScale: 1 },
});
