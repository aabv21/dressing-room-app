import { LogBox } from 'react-native';

import { isE2eLaunch, quietDevToastsForE2e } from '../e2eLaunch';

// Jest has no native SettingsManager; the test sets what the user defaults hold.
const mockSettings = new Map<string, unknown>();
let mockSettingsMissing = false;
jest.mock('react-native/Libraries/Settings/Settings', () => ({
  __esModule: true,
  default: {
    get: (key: string): unknown => {
      if (mockSettingsMissing) throw new Error("TurboModuleRegistry: 'SettingsManager' could not be found");
      return mockSettings.get(key);
    },
  },
}));

afterEach(() => {
  mockSettings.clear();
  mockSettingsMissing = false;
  jest.restoreAllMocks();
});

test('an e2e launch is one Maestro started with `-e2e 1`', () => {
  mockSettings.set('e2e', '1');
  expect(isE2eLaunch()).toBe(true);
});

test('any other launch is not', () => {
  expect(isE2eLaunch()).toBe(false);
  mockSettings.set('e2e', '0');
  expect(isE2eLaunch()).toBe(false);
});

test('a runtime without the native settings module is not an e2e launch', () => {
  mockSettingsMissing = true;
  expect(isE2eLaunch()).toBe(false);
});

test('an e2e launch hides the dev warning toasts that cover the anchored CTAs', () => {
  mockSettings.set('e2e', '1');
  const ignoreAll = jest.spyOn(LogBox, 'ignoreAllLogs').mockImplementation(() => undefined);
  quietDevToastsForE2e();
  expect(ignoreAll).toHaveBeenCalledWith(true);
});

test('a normal launch keeps them', () => {
  const ignoreAll = jest.spyOn(LogBox, 'ignoreAllLogs').mockImplementation(() => undefined);
  quietDevToastsForE2e();
  expect(ignoreAll).not.toHaveBeenCalled();
});
