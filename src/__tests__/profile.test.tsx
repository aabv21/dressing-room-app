// The Profile tab through the REAL route tree (expo-router's testing library), with the repository,
// the auth service and `useAuth()` mocked at their seams. Lives outside src/app/ because every file
// there becomes a route.
// The closet providers wrap the signed-in navigator; this suite doesn't test the closet.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return -- jest.mock()'s factory can only reference globals (incl. `require`), not a module-scoped import
jest.mock('../closet/ClosetProvider', () => require('../test/closetProvidersMock'));
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return -- same as above
jest.mock('../closet/UploadQueueProvider', () => require('../test/closetProvidersMock'));

jest.mock('../auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children?: React.ReactNode }) => children,
  useAuth: jest.fn(),
}));

jest.mock('../profile/profileRepository', () => ({
  getProfile: jest.fn(),
  saveProfile: jest.fn(),
  completeOnboarding: jest.fn(),
}));

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve()),
  hideAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('../auth/authService', () => ({
  signUpWithEmail: jest.fn(),
  signInWithEmail: jest.fn(),
  requestPasswordReset: jest.fn(),
  confirmPasswordReset: jest.fn(),
  signInWithApple: jest.fn(),
  signInWithGoogle: jest.fn(),
  signOut: jest.fn(() => Promise.resolve({ ok: true })),
}));

jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationButton: () => null,
  AppleAuthenticationButtonType: { CONTINUE: 1 },
  AppleAuthenticationButtonStyle: { BLACK: 2 },
}));

jest.mock('expo-location', () => ({
  Accuracy: { Low: 2 },
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
}));

import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '../auth/AuthProvider';
import { signOut } from '../auth/authService';
import { translate } from '../i18n';
import { kvGet, kvRemove, kvSet } from '../lib/kv';
import { getProfile, saveProfile } from '../profile/profileRepository';
import type { Profile } from '../profile/profileRepository';

const mockedUseAuth = jest.mocked(useAuth);
const mockedGetProfile = jest.mocked(getProfile);
const mockedSaveProfile = jest.mocked(saveProfile);

const USER_ID = 'user-1';
const LOCALE_PREFERENCE_KEY = 'locale-preference';
const LANGUAGE_PENDING_KEY = 'language-save-pending';

function profileRow(overrides: Partial<Profile> = {}): Profile {
  return {
    user_id: USER_ID,
    clothing_type: 'feminine',
    body_type: 'hourglass',
    height_cm: 168,
    chest_cm: null,
    waist_cm: 70,
    hips_cm: null,
    top_size: 'M',
    bottom_size: null,
    shoe_size: null,
    age_group: '25_34',
    styles: ['casual'],
    occasions: ['office'],
    city_name: 'Bogotá',
    city_lat: 4.711,
    city_lon: -74.0721,
    language: null,
    onboarding_completed_at: '2026-11-01T00:00:00Z',
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    ...overrides,
  };
}

async function openProfile(profile: Profile | null = profileRow()) {
  mockedGetProfile.mockResolvedValue(profile);
  const router = await renderRouter({ appDir: 'src/app', overrides: {} }, { initialUrl: '/profile' });
  await screen.findByTestId('profile-form');
  return router;
}

function saveButton() {
  return screen.getByRole('button', { name: /^(Save changes|Saved|Guardar cambios|Guardado)$/ });
}

beforeEach(() => {
  jest.clearAllMocks();
  kvRemove(LOCALE_PREFERENCE_KEY);
  kvRemove(LANGUAGE_PENDING_KEY);
  mockedUseAuth.mockReturnValue({
    status: 'signedIn',
    userId: USER_ID,
    email: 'ana@example.com',
    onboardingComplete: true,
    refreshProfile: jest.fn(() => Promise.resolve(true)),
  });
  mockedSaveProfile.mockResolvedValue({ ok: true });
});

test('shows every section prefilled, the account email, and a disabled Save', async () => {
  await openProfile();

  for (const heading of ['YOUR CLOTHES', 'YOUR BODY', 'YOUR STYLE', 'LANGUAGE', 'ACCOUNT']) {
    expect(screen.getByRole('header', { name: heading })).toBeTruthy();
  }
  expect(screen.getByRole('radio', { name: /^Feminine/ })).toBeSelected();
  expect(screen.getByRole('radio', { name: 'Hourglass' })).toBeSelected();
  expect(screen.getByTestId('body-height-value')).toHaveTextContent('1.68 m');
  expect(screen.getByTestId('body-waist').props.value).toBe('70');
  expect(screen.getByRole('checkbox', { name: 'Casual' })).toBeChecked();
  expect(screen.getByLabelText('Your city, for the weather').props.value).toBe('Bogotá');
  expect(screen.getByText('ana@example.com')).toBeTruthy();
  expect(saveButton()).toBeDisabled();
});

test('edits enable Save, and Save sends only the changed fields', async () => {
  await openProfile();

  await fireEvent(screen.getByTestId('body-height-slider'), 'valueChange', 180);
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Urban' }));
  await fireEvent.changeText(screen.getByTestId('body-top-size'), ' L ');
  expect(saveButton()).toBeEnabled();

  await fireEvent.press(saveButton());

  await waitFor(() => {
    expect(mockedSaveProfile).toHaveBeenCalledTimes(1);
  });
  expect(mockedSaveProfile).toHaveBeenCalledWith(USER_ID, { height_cm: 180, top_size: 'L', styles: ['casual', 'urban'] });
  expect(await screen.findByRole('button', { name: 'Saved' })).toBeDisabled();
  // The saved values become the new baseline: the trimmed size shows, and nothing is dirty.
  expect(screen.getByTestId('body-top-size').props.value).toBe('L');
});

test('a height never saved shows as not set (not the slider default) until the slider moves', async () => {
  // e.g. the user skipped the Body step during onboarding.
  await openProfile(profileRow({ height_cm: null }));

  expect(screen.getByTestId('body-height-value')).toHaveTextContent('Not set');
  expect(screen.getByText('Move the slider to set your height.')).toBeTruthy();
  expect(screen.getByTestId('body-height-slider').props.accessibilityValue).toMatchObject({ text: 'Not set' });
  expect(saveButton()).toBeDisabled();

  await fireEvent(screen.getByTestId('body-height-slider'), 'valueChange', 172);

  expect(screen.getByTestId('body-height-value')).toHaveTextContent('1.72 m');
  expect(screen.queryByText('Move the slider to set your height.')).toBeNull();
  await fireEvent.press(saveButton());
  await waitFor(() => {
    expect(mockedSaveProfile).toHaveBeenCalledWith(USER_ID, { height_cm: 172 });
  });
});

test('undoing an edit makes the form clean again', async () => {
  await openProfile();

  await fireEvent.press(screen.getByRole('checkbox', { name: 'Urban' }));
  expect(saveButton()).toBeEnabled();
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Urban' }));

  expect(saveButton()).toBeDisabled();
});

test('switching to a clothing type without the saved silhouette clears it on Save', async () => {
  await openProfile();

  await fireEvent.press(screen.getByRole('radio', { name: /^Masculine/ }));
  expect(screen.getByRole('radio', { name: 'Trapezoid' })).toBeTruthy();
  await fireEvent.press(saveButton());

  await waitFor(() => {
    expect(mockedSaveProfile).toHaveBeenCalledWith(USER_ID, { clothing_type: 'masculine', body_type: null });
  });
});

test('invalid measurements block Save with inline errors, shown on the save attempt and announced', async () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  await openProfile();

  await fireEvent.changeText(screen.getByTestId('body-waist'), 'abc');
  await fireEvent.changeText(screen.getByTestId('body-shoe-size'), 'ABCDEFGHIJK');
  // Not while typing: a half-typed value isn't an error yet.
  expect(screen.queryByText('Enter a whole number from 40 to 200.')).toBeNull();
  // Save stays tappable so it can explain what's wrong.
  expect(saveButton()).toBeEnabled();

  await fireEvent.press(saveButton());

  expect(screen.getByText('Enter a whole number from 40 to 200.')).toBeTruthy();
  expect(screen.getByText('Use 1 to 10 characters.')).toBeTruthy();
  expect(announce).toHaveBeenCalledWith('Enter a whole number from 40 to 200.');
  expect(mockedSaveProfile).not.toHaveBeenCalled();
  announce.mockRestore();
});

test("a field's error shows once the user leaves it, and clears as soon as it is fixed", async () => {
  await openProfile();

  await fireEvent.changeText(screen.getByTestId('body-waist'), '7');
  expect(screen.queryByText('Enter a whole number from 40 to 200.')).toBeNull();
  await fireEvent(screen.getByTestId('body-waist'), 'blur');
  expect(screen.getByText('Enter a whole number from 40 to 200.')).toBeTruthy();

  await fireEvent.changeText(screen.getByTestId('body-waist'), '72');
  expect(screen.queryByText('Enter a whole number from 40 to 200.')).toBeNull();
  await fireEvent.press(saveButton());
  await waitFor(() => {
    expect(mockedSaveProfile).toHaveBeenCalledWith(USER_ID, { waist_cm: 72 });
  });
});

test('a failed save shows the error and keeps every edit', async () => {
  mockedSaveProfile.mockResolvedValueOnce({ ok: false, error: 'profile.error.network' });
  await openProfile();

  await fireEvent.press(screen.getByRole('checkbox', { name: 'Urban' }));
  await fireEvent.press(saveButton());

  expect(await screen.findByText(translate('en', 'profile.error.network'))).toBeTruthy();
  expect(screen.getByRole('checkbox', { name: 'Urban' })).toBeChecked();
  expect(saveButton()).toBeEnabled();
});

test('switching the language to English relabels the screen and the tabs, and saves language "en"', async () => {
  kvSet(LOCALE_PREFERENCE_KEY, 'es');
  await openProfile();
  expect(screen.getByText('PERFIL')).toBeTruthy();
  expect(screen.getByRole('header', { name: 'TU ROPA' })).toBeTruthy();
  expect(screen.getByText('Perfil')).toBeTruthy();

  await fireEvent.press(screen.getByRole('tab', { name: 'English' }));

  expect(screen.getByText('PROFILE')).toBeTruthy();
  expect(screen.getByRole('header', { name: 'YOUR CLOTHES' })).toBeTruthy();
  expect(screen.getByText('Profile')).toBeTruthy();
  expect(screen.queryByText('PERFIL')).toBeNull();
  await waitFor(() => {
    expect(mockedSaveProfile).toHaveBeenCalledWith(USER_ID, { language: 'en' });
  });
  expect(kvGet(LOCALE_PREFERENCE_KEY)).toBe('en');
  expect(screen.getByRole('checkbox', { name: 'Use device language' })).not.toBeChecked();
  // The language is saved on its own; it never makes the form dirty.
  expect(saveButton()).toBeDisabled();
});

test('"Use device language" saves null and makes the preference "system"', async () => {
  kvSet(LOCALE_PREFERENCE_KEY, 'es');
  await openProfile(profileRow({ language: 'es' }));
  expect(screen.getByRole('checkbox', { name: 'Usar el idioma del teléfono' })).not.toBeChecked();

  await fireEvent.press(screen.getByRole('checkbox', { name: 'Usar el idioma del teléfono' }));

  await waitFor(() => {
    expect(mockedSaveProfile).toHaveBeenCalledWith(USER_ID, { language: null });
  });
  expect(kvGet(LOCALE_PREFERENCE_KEY)).toBe('system');
  // The mocked device language is English.
  expect(screen.getByText('PROFILE')).toBeTruthy();
  expect(screen.getByRole('checkbox', { name: 'Use device language' })).toBeChecked();
});

test('a language that fails to save still applies, and says it was not saved', async () => {
  mockedSaveProfile.mockResolvedValueOnce({ ok: false, error: 'profile.error.network' });
  await openProfile();

  await fireEvent.press(screen.getByRole('tab', { name: 'Español' }));

  expect(screen.getByText('PERFIL')).toBeTruthy();
  expect(await screen.findByText(translate('es', 'profile.error.network'))).toBeTruthy();
  // Remembered, so the next launch retries it instead of reverting to the server's value.
  expect(kvGet(LANGUAGE_PENDING_KEY)).toBe(USER_ID);
});

test('a language save that goes through clears an earlier pending one', async () => {
  kvSet(LANGUAGE_PENDING_KEY, USER_ID);
  await openProfile();

  await fireEvent.press(screen.getByRole('tab', { name: 'Español' }));

  await waitFor(() => {
    expect(kvGet(LANGUAGE_PENDING_KEY)).toBeNull();
  });
});

test('language saves run in order, and a superseded failure is not shown', async () => {
  let failFirst: (value: { ok: false; error: 'profile.error.network' }) => void = () => undefined;
  mockedSaveProfile.mockReturnValueOnce(
    new Promise((resolve) => {
      failFirst = resolve;
    }),
  );
  await openProfile();

  await fireEvent.press(screen.getByRole('tab', { name: 'Español' }));
  await fireEvent.press(screen.getByRole('tab', { name: 'English' }));
  // The second save waits for the first, so the server ends with the last choice.
  expect(mockedSaveProfile).toHaveBeenCalledTimes(1);
  expect(mockedSaveProfile).toHaveBeenLastCalledWith(USER_ID, { language: 'es' });

  await act(async () => {
    failFirst({ ok: false, error: 'profile.error.network' });
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(mockedSaveProfile).toHaveBeenCalledTimes(2);
  });
  expect(mockedSaveProfile).toHaveBeenLastCalledWith(USER_ID, { language: 'en' });
  expect(screen.queryByText(translate('en', 'profile.error.network'))).toBeNull();
  expect(screen.getByText('PROFILE')).toBeTruthy();
});

test('another account signing in reloads the form instead of showing the previous one', async () => {
  await openProfile(profileRow({ height_cm: 168 }));
  expect(screen.getByTestId('body-height-value')).toHaveTextContent('1.68 m');

  mockedGetProfile.mockResolvedValue(profileRow({ user_id: 'user-2', height_cm: 190 }));
  mockedUseAuth.mockReturnValue({
    status: 'signedIn',
    userId: 'user-2',
    email: 'ben@example.com',
    onboardingComplete: true,
    refreshProfile: jest.fn(() => Promise.resolve(true)),
  });
  // Any context change re-renders the screen; a language switch is one available without touch.
  await fireEvent.press(screen.getByRole('tab', { name: 'Español' }));

  await waitFor(() => {
    expect(screen.getByTestId('body-height-value')).toHaveTextContent('1,90 m');
  });
  expect(mockedGetProfile).toHaveBeenLastCalledWith('user-2');
  expect(screen.getByText('ben@example.com')).toBeTruthy();
});

test('Sign out calls signOut', async () => {
  await openProfile();

  await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));

  expect(signOut).toHaveBeenCalledTimes(1);
});

test('a failed sign-out is shown', async () => {
  jest.mocked(signOut).mockResolvedValueOnce({ ok: false, error: 'auth.error.unknown' });
  await openProfile();

  await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));

  expect(await screen.findByText(translate('en', 'auth.error.unknown'))).toBeTruthy();
});

test('a failed profile read shows a retry (and sign-out) instead of an empty form', async () => {
  mockedGetProfile.mockRejectedValueOnce(new TypeError('Network request failed'));
  await renderRouter({ appDir: 'src/app', overrides: {} }, { initialUrl: '/profile' });

  expect(await screen.findByText(translate('en', 'onboarding.loadError'))).toBeTruthy();
  expect(screen.queryByTestId('profile-form')).toBeNull();
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();

  mockedGetProfile.mockResolvedValueOnce(profileRow({ height_cm: 190 }));
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));

  expect(await screen.findByTestId('profile-form')).toBeTruthy();
  expect(screen.getByTestId('body-height-value')).toHaveTextContent('1.90 m');
});
