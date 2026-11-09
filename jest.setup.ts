import { Dimensions } from 'react-native';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- jest.mock()'s factory can only reference globals (incl. `require`), not a module-scoped import; see https://jestjs.io/docs/jest-object#jestmockmodulename-factory-options
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US', languageCode: 'en' }] }));

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
