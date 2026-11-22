// A module mock for `../push/pushRegistration`, for suites that render Profile or sign out without
// the Supabase client:
//   jest.mock('../push/pushRegistration', () => require('../test/pushClientsMock'));
export const setPushPreferences = jest.fn(() => Promise.resolve('saved'));
export const forgetPushToken = jest.fn(() => Promise.resolve());
export const flushPendingUnregister = jest.fn(() => Promise.resolve());
