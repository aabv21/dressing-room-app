// Drives the three onboarding steps through the REAL route tree and navigator (expo-router's
// testing library, as in auth-guards.test.tsx), with the repository and `useAuth()` mocked at their
// seams. Lives outside src/app/ because every file there becomes a route.
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

import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { renderRouter, testRouter } from 'expo-router/testing-library';

import { useAuth } from '../auth/AuthProvider';
import { signOut } from '../auth/authService';
import { silhouettesFor } from '../profile/bodyType';
import { completeOnboarding, getProfile, saveProfile } from '../profile/profileRepository';
import type { Profile } from '../profile/profileRepository';
import { translate } from '../i18n';
import { kvRemove, kvSet } from '../lib/kv';

const mockedUseAuth = jest.mocked(useAuth);
const mockedGetProfile = jest.mocked(getProfile);
const mockedSaveProfile = jest.mocked(saveProfile);
const mockedCompleteOnboarding = jest.mocked(completeOnboarding);
const refreshProfile = jest.fn(() => Promise.resolve(true));

const USER_ID = 'user-1';

function profileRow(overrides: Partial<Profile> = {}): Profile {
  return {
    user_id: USER_ID,
    clothing_type: null,
    body_type: null,
    height_cm: null,
    chest_cm: null,
    waist_cm: null,
    hips_cm: null,
    top_size: null,
    bottom_size: null,
    shoe_size: null,
    age_group: null,
    styles: [],
    occasions: [],
    city_name: null,
    city_lat: null,
    city_lon: null,
    language: null,
    onboarding_completed_at: null,
    created_at: '2026-11-05T00:00:00Z',
    updated_at: '2026-11-05T00:00:00Z',
    ...overrides,
  };
}

async function launch(profile: Profile | null = profileRow()) {
  mockedGetProfile.mockResolvedValue(profile);
  return renderRouter({ appDir: 'src/app', overrides: {} }, { initialUrl: '/' });
}

afterEach(() => {
  kvRemove('locale-preference');
});

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseAuth.mockReturnValue({ status: 'signedIn', userId: USER_ID, email: 'ana@example.com', onboardingComplete: false, refreshProfile });
  mockedSaveProfile.mockResolvedValue({ ok: true });
  mockedCompleteOnboarding.mockResolvedValue({ ok: true });
});

describe('Clothing step', () => {
  test('Next stays disabled until a type is chosen; choosing one saves it and moves to Body', async () => {
    const router = await launch();

    expect(await screen.findByText('WHAT CLOTHES DO YOU WEAR?')).toBeTruthy();
    expect(router.getPathname()).toBe('/clothing');
    expect(screen.getByRole('progressbar', { name: 'Step 1 of 3' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    await fireEvent.press(screen.getByRole('radio', { name: /^Masculine/ }));
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(router.getPathname()).toBe('/body');
    });
    expect(mockedSaveProfile).toHaveBeenCalledWith(USER_ID, { clothing_type: 'masculine' });
  });

  test('has a sign-out link, so onboarding is not a dead end (P2-R9)', async () => {
    await launch();
    await screen.findByText('WHAT CLOTHES DO YOU WEAR?');

    await fireEvent.press(screen.getByRole('link', { name: 'Sign out' }));

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  test('a network failure shows profile.error.network, keeps the choice and stays put (Review Focus 4)', async () => {
    mockedSaveProfile.mockResolvedValueOnce({ ok: false, error: 'profile.error.network' });
    const router = await launch();
    await screen.findByText('WHAT CLOTHES DO YOU WEAR?');

    await fireEvent.press(screen.getByRole('radio', { name: /^Feminine/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText(translate('en', 'profile.error.network'))).toBeTruthy();
    expect(router.getPathname()).toBe('/clothing');
    expect(screen.getByRole('radio', { name: /^Feminine/ })).toBeSelected();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });
});

describe('Body step', () => {
  async function openBody(clothing: Profile['clothing_type'] = 'feminine', overrides: Partial<Profile> = {}) {
    const router = await launch(profileRow({ clothing_type: clothing, ...overrides }));
    await screen.findByText('YOUR BODY');
    return router;
  }

  test.each(['feminine', 'masculine', 'everything'] as const)('shows silhouettesFor(%s)', async (clothing) => {
    await openBody(clothing);

    const shown = screen.getAllByRole('radio').map((cell) => cell.props.accessibilityLabel as string);
    expect(shown).toEqual(silhouettesFor(clothing).map((type) => translate('en', `bodyType.${type}`)));
  });

  test('the 3-question helper selects the suggested silhouette, and Next saves it', async () => {
    const router = await openBody('masculine');

    await fireEvent.press(screen.getByRole('button', { name: /Not sure\?/ }));
    const panel = screen.getByTestId('body-helper-panel');
    await fireEvent.press(within(panel).getByRole('radio', { name: 'Broad' }));
    // Shoulders and hips both offer "Narrow"; the second one is the hips question.
    const hipsNarrow = within(panel).getAllByRole('radio', { name: 'Narrow' })[1];
    if (hipsNarrow === undefined) {
      throw new Error('expected a "Narrow" answer for the hips question');
    }
    await fireEvent.press(hipsNarrow);
    await fireEvent.press(within(panel).getByRole('radio', { name: 'Defined' }));

    expect(screen.getByText('We suggest: Trapezoid')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Trapezoid' })).toBeSelected();

    await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/style');
    });
    expect(mockedSaveProfile).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ body_type: 'trapezoid', height_cm: 175 }),
    );
  });

  test('height defaults to 165 (feminine) and the slider updates the label and the save', async () => {
    await openBody('feminine');
    expect(screen.getByTestId('body-height-value')).toHaveTextContent('1.65 m');

    await fireEvent(screen.getByTestId('body-height-slider'), 'valueChange', 181);
    expect(screen.getByTestId('body-height-value')).toHaveTextContent('1.81 m');

    await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(mockedSaveProfile).toHaveBeenCalledWith(USER_ID, expect.objectContaining({ height_cm: 181 }));
    });
  });

  test('Skip saves nothing and moves on to Style', async () => {
    const router = await openBody('feminine');

    await fireEvent.press(screen.getByRole('button', { name: 'Skip' }));

    await waitFor(() => {
      expect(router.getPathname()).toBe('/style');
    });
    expect(mockedSaveProfile).not.toHaveBeenCalled();
  });

  test('invalid measurements show inline errors and do not save', async () => {
    const router = await openBody('feminine');

    await fireEvent.press(screen.getByRole('button', { name: /optional/ }));
    await fireEvent.changeText(screen.getByTestId('body-waist'), 'abc');
    await fireEvent.changeText(screen.getByTestId('body-top-size'), 'ABCDEFGHIJK');
    await fireEvent.press(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('Enter a whole number from 40 to 200.')).toBeTruthy();
    expect(screen.getByText('Use 1 to 10 characters.')).toBeTruthy();
    expect(mockedSaveProfile).not.toHaveBeenCalled();
    expect(router.getPathname()).toBe('/body');
  });

  test('a network failure shows profile.error.network and keeps every entry (Review Focus 4)', async () => {
    mockedSaveProfile.mockResolvedValueOnce({ ok: false, error: 'profile.error.network' });
    const router = await openBody('feminine');

    await fireEvent.press(screen.getByRole('radio', { name: 'Pear' }));
    await fireEvent(screen.getByTestId('body-height-slider'), 'valueChange', 158);
    await fireEvent.press(screen.getByRole('button', { name: /optional/ }));
    await fireEvent.changeText(screen.getByTestId('body-chest'), '90');
    await fireEvent.changeText(screen.getByTestId('body-top-size'), '  M ');
    await fireEvent.press(screen.getByRole('radio', { name: '25–34' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText(translate('en', 'profile.error.network'))).toBeTruthy();
    expect(mockedSaveProfile).toHaveBeenCalledWith(USER_ID, {
      body_type: 'pear',
      height_cm: 158,
      chest_cm: 90,
      waist_cm: null,
      hips_cm: null,
      top_size: 'M',
      bottom_size: null,
      shoe_size: null,
      age_group: '25_34',
    });
    expect(router.getPathname()).toBe('/body');
    expect(screen.getByRole('radio', { name: 'Pear' })).toBeSelected();
    expect(screen.getByTestId('body-height-value')).toHaveTextContent('1.58 m');
    expect(screen.getByTestId('body-chest').props.value).toBe('90');
    expect(screen.getByTestId('body-top-size').props.value).toBe('  M ');
    expect(screen.getByRole('radio', { name: '25–34' })).toBeSelected();
  });
});

describe('Style step', () => {
  async function openStyle() {
    const router = await launch(profileRow({ clothing_type: 'feminine' }));
    await screen.findByText('YOUR BODY');
    await fireEvent.press(screen.getByRole('button', { name: 'Skip' }));
    await screen.findByText('YOUR STYLE');
    return router;
  }

  test('chips save styles and occasions; Start completes onboarding and then refreshes the profile', async () => {
    await openStyle();

    await fireEvent.press(screen.getByRole('checkbox', { name: 'Casual' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Minimalist' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Office' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Going out' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Office' }));
    await fireEvent.changeText(screen.getByLabelText('Your city, for the weather'), ' Bogotá ');
    await fireEvent.press(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => {
      expect(refreshProfile).toHaveBeenCalledTimes(1);
    });
    expect(mockedSaveProfile).toHaveBeenCalledWith(USER_ID, {
      styles: ['casual', 'minimalist'],
      occasions: ['going_out'],
      city_name: 'Bogotá',
      city_lat: null,
      city_lon: null,
    });
    expect(mockedCompleteOnboarding).toHaveBeenCalledWith(USER_ID);
    const saveOrder = mockedSaveProfile.mock.invocationCallOrder[0] ?? Infinity;
    const completeOrder = mockedCompleteOnboarding.mock.invocationCallOrder[0] ?? -1;
    const refreshOrder = refreshProfile.mock.invocationCallOrder[0] ?? -1;
    expect(saveOrder).toBeLessThan(completeOrder);
    expect(completeOrder).toBeLessThan(refreshOrder);
  });

  test('"Use my location" with permission denied shows a message and keeps the manual city field', async () => {
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({
      status: Location.PermissionStatus.DENIED,
      granted: false,
      canAskAgain: true,
      expires: 'never',
    });
    await openStyle();

    await fireEvent.press(screen.getByRole('button', { name: 'use my location' }));

    expect(await screen.findByText('Location access is off. Type your city instead.')).toBeTruthy();
    const cityField = screen.getByLabelText('Your city, for the weather');
    await fireEvent.changeText(cityField, 'Medellín');
    await fireEvent.press(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => {
      expect(mockedSaveProfile).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({ city_name: 'Medellín', city_lat: null, city_lon: null }),
      );
    });
  });

  test('"Use my location" with permission fills the city and saves its coordinates', async () => {
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({
      status: Location.PermissionStatus.GRANTED,
      granted: true,
      canAskAgain: true,
      expires: 'never',
    });
    jest.mocked(Location.getCurrentPositionAsync).mockResolvedValue({
      coords: { latitude: 4.711, longitude: -74.0721, altitude: null, accuracy: 100, altitudeAccuracy: null, heading: null, speed: null },
      timestamp: 0,
    });
    jest.mocked(Location.reverseGeocodeAsync).mockResolvedValue([
      {
        city: 'Bogotá',
        subregion: null,
        region: null,
        district: null,
        street: null,
        streetNumber: null,
        country: null,
        postalCode: null,
        name: null,
        isoCountryCode: null,
        timezone: null,
        formattedAddress: null,
      },
    ]);
    await openStyle();

    await fireEvent.press(screen.getByRole('button', { name: 'use my location' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Your city, for the weather').props.value).toBe('Bogotá');
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Start' }));

    // Rounded to city precision (2 decimals) before it is saved.
    await waitFor(() => {
      expect(mockedSaveProfile).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({ city_name: 'Bogotá', city_lat: 4.71, city_lon: -74.07 }),
      );
    });
  });

  test('Skip completes onboarding without saving the step', async () => {
    await openStyle();

    await fireEvent.press(screen.getByRole('button', { name: 'Skip' }));

    await waitFor(() => {
      expect(refreshProfile).toHaveBeenCalledTimes(1);
    });
    expect(mockedCompleteOnboarding).toHaveBeenCalledWith(USER_ID);
    expect(mockedSaveProfile).not.toHaveBeenCalled();
  });

  test('a failed save keeps the chips and does not complete onboarding (Review Focus 4)', async () => {
    mockedSaveProfile.mockResolvedValueOnce({ ok: false, error: 'profile.error.network' });
    await openStyle();

    await fireEvent.press(screen.getByRole('checkbox', { name: 'Urban' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Start' }));

    expect(await screen.findByText(translate('en', 'profile.error.network'))).toBeTruthy();
    expect(mockedCompleteOnboarding).not.toHaveBeenCalled();
    expect(refreshProfile).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: 'Urban' })).toBeChecked();
  });
});

describe('Relaunch mid-onboarding (Review Focus 3)', () => {
  test('lands back in onboarding at Body with the saved values prefilled, with Clothing underneath', async () => {
    const router = await launch(
      profileRow({ clothing_type: 'feminine', height_cm: 172, body_type: 'pear', chest_cm: 88, age_group: '35_44' }),
    );

    expect(await screen.findByText('YOUR BODY')).toBeTruthy();
    expect(router.getSegments()).toContain('(onboarding)');
    expect(router.getPathname()).toBe('/body');
    expect(screen.getByTestId('body-height-value')).toHaveTextContent('1.72 m');
    expect(screen.getByTestId('body-height-slider').props.value).toBe(172);
    expect(screen.getByRole('radio', { name: 'Pear' })).toBeSelected();
    // Saved optional values open their section so they're visible, not hidden behind the toggle.
    expect(screen.getByTestId('body-chest').props.value).toBe('88');
    expect(screen.getByRole('radio', { name: '35–44' })).toBeSelected();

    await testRouter.back('/clothing');
    expect(await screen.findByText('WHAT CLOTHES DO YOU WEAR?')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^Feminine/ })).toBeSelected();
  });

  test('without a saved clothing type it starts at Clothing', async () => {
    const router = await launch(profileRow());

    await screen.findByText('WHAT CLOTHES DO YOU WEAR?');
    expect(router.getPathname()).toBe('/clothing');
  });
});

describe('Never clobbering a finished profile (P2 binding item a)', () => {
  test('a failed profile read shows a retry instead of the steps, and nothing is saved', async () => {
    mockedGetProfile.mockRejectedValueOnce(new TypeError('Network request failed'));
    await renderRouter({ appDir: 'src/app', overrides: {} }, { initialUrl: '/' });

    expect(await screen.findByText(translate('en', 'onboarding.loadError'))).toBeTruthy();
    expect(screen.queryByText('WHAT CLOTHES DO YOU WEAR?')).toBeNull();
    expect(screen.getByRole('link', { name: 'Sign out' })).toBeTruthy();

    mockedGetProfile.mockResolvedValueOnce(profileRow({ clothing_type: 'masculine', height_cm: 190 }));
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('YOUR BODY')).toBeTruthy();
    expect(screen.getByTestId('body-height-value')).toHaveTextContent('1.90 m');
    expect(mockedSaveProfile).not.toHaveBeenCalled();
  });

  test('a profile that is already complete hands back to AuthProvider without rendering a step', async () => {
    await launch(profileRow({ clothing_type: 'feminine', height_cm: 170, onboarding_completed_at: '2026-11-01T00:00:00Z' }));

    await waitFor(() => {
      expect(refreshProfile).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText('YOUR BODY')).toBeNull();
    expect(screen.queryByText('WHAT CLOTHES DO YOU WEAR?')).toBeNull();
    expect(mockedSaveProfile).not.toHaveBeenCalled();
    expect(mockedCompleteOnboarding).not.toHaveBeenCalled();
  });
});

describe('Task 6 follow-ups (P2-R12)', () => {
  const GRANTED = { status: Location.PermissionStatus.GRANTED, granted: true, canAskAgain: true, expires: 'never' } as const;
  const COORDS = { latitude: 4.711, longitude: -74.0721, altitude: null, accuracy: 100, altitudeAccuracy: null, heading: null, speed: null };
  const ADDRESS = {
    city: 'Bogotá', subregion: null, region: null, district: null, street: null, streetNumber: null, country: null,
    postalCode: null, name: null, isoCountryCode: null, timezone: null, formattedAddress: null,
  };

  test('in Spanish, the hips answers agree with "caderas" (feminine), the shoulder answers with "hombros"', async () => {
    kvSet('locale-preference', 'es');
    await launch(profileRow({ clothing_type: 'feminine' }));
    await screen.findByText('TU CUERPO');

    await fireEvent.press(screen.getByRole('button', { name: /¿No sabes\?/ }));

    const answers = within(screen.getByTestId('body-helper-panel'))
      .getAllByRole('radio')
      .map((chip) => chip.props.accessibilityLabel as string);
    // Shoulders, then hips, then waist.
    expect(answers.slice(0, 3)).toEqual(['Estrechos', 'Medios', 'Anchos']);
    expect(answers.slice(3, 6)).toEqual(['Estrechas', 'Medias', 'Anchas']);
  });

  test('deselecting a saved silhouette saves body_type as null', async () => {
    await launch(profileRow({ clothing_type: 'feminine', body_type: 'pear', height_cm: 160 }));
    await screen.findByText('YOUR BODY');

    await fireEvent.press(screen.getByRole('radio', { name: 'Pear' }));
    expect(screen.getByRole('radio', { name: 'Pear' })).not.toBeSelected();
    await fireEvent.press(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(mockedSaveProfile).toHaveBeenCalledWith(USER_ID, expect.objectContaining({ body_type: null, height_cm: 160 }));
    });
  });

  test('switching clothing type to a set without the saved silhouette clears body_type', async () => {
    const router = await launch(profileRow({ clothing_type: 'feminine', body_type: 'hourglass' }));
    await screen.findByText('YOUR BODY');
    await testRouter.back('/clothing');
    await screen.findByText('WHAT CLOTHES DO YOU WEAR?');

    await fireEvent.press(screen.getByRole('radio', { name: /^Masculine/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(router.getPathname()).toBe('/body');
    });
    expect(mockedSaveProfile).toHaveBeenCalledWith(USER_ID, { clothing_type: 'masculine', body_type: null });
  });

  test('switching to a clothing type that still offers the saved silhouette keeps it', async () => {
    await launch(profileRow({ clothing_type: 'feminine', body_type: 'rectangle' }));
    await screen.findByText('YOUR BODY');
    await testRouter.back('/clothing');
    await screen.findByText('WHAT CLOTHES DO YOU WEAR?');

    await fireEvent.press(screen.getByRole('radio', { name: /^Masculine/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(mockedSaveProfile).toHaveBeenCalledWith(USER_ID, { clothing_type: 'masculine' });
    });
  });

  test('a failed sign-out is shown instead of silently doing nothing', async () => {
    jest.mocked(signOut).mockResolvedValueOnce({ ok: false, error: 'auth.error.unknown' });
    await launch();
    await screen.findByText('WHAT CLOTHES DO YOU WEAR?');

    await fireEvent.press(screen.getByRole('link', { name: 'Sign out' }));

    expect(await screen.findByText(translate('en', 'auth.error.unknown'))).toBeTruthy();
  });

  test('Start shows a message (and stays on Style) when the post-completion refresh fails', async () => {
    refreshProfile.mockResolvedValueOnce(false);
    const router = await launch(profileRow({ clothing_type: 'feminine' }));
    await screen.findByText('YOUR BODY');
    await fireEvent.press(screen.getByRole('button', { name: 'Skip' }));
    await screen.findByText('YOUR STYLE');

    await fireEvent.press(screen.getByRole('button', { name: 'Start' }));

    expect(await screen.findByText(translate('en', 'onboarding.error.continue'))).toBeTruthy();
    expect(mockedCompleteOnboarding).toHaveBeenCalledWith(USER_ID);
    expect(router.getPathname()).toBe('/style');
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();
  });

  test('a location result that arrives after the user typed a city is ignored', async () => {
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(GRANTED);
    jest.mocked(Location.getCurrentPositionAsync).mockResolvedValue({ coords: COORDS, timestamp: 0 });
    let resolveGeocode: (value: (typeof ADDRESS)[]) => void = () => undefined;
    jest.mocked(Location.reverseGeocodeAsync).mockReturnValue(
      new Promise((resolve) => {
        resolveGeocode = resolve;
      }),
    );
    await launch(profileRow({ clothing_type: 'feminine' }));
    await screen.findByText('YOUR BODY');
    await fireEvent.press(screen.getByRole('button', { name: 'Skip' }));
    await screen.findByText('YOUR STYLE');

    await fireEvent.press(screen.getByRole('button', { name: 'use my location' }));
    await fireEvent.changeText(screen.getByLabelText('Your city, for the weather'), 'Cali');
    resolveGeocode([ADDRESS]);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'use my location' })).toBeEnabled();
    });

    expect(screen.getByLabelText('Your city, for the weather').props.value).toBe('Cali');
    await fireEvent.press(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => {
      expect(mockedSaveProfile).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({ city_name: 'Cali', city_lat: null, city_lon: null }),
      );
    });
  });

  describe('height slider', () => {
    test('in range, the thumb, the label and the spoken value agree, in metres', async () => {
      await launch(profileRow({ clothing_type: 'feminine', height_cm: 172 }));
      await screen.findByText('YOUR BODY');

      const slider = screen.getByTestId('body-height-slider');
      expect(slider.props.value).toBe(172);
      expect(screen.getByTestId('body-height-value')).toHaveTextContent('1.72 m');
      expect(slider.props.accessibilityValue).toEqual({ min: 140, max: 210, now: 172, text: '1.72 meters' });
      // Never the slider's own spoken-increment props: Android parses them as integers (P2-R13 I1).
      expect(slider.props.accessibilityIncrements).toBeUndefined();
      expect(slider.props.accessibilityUnits).toBeUndefined();
      expect(screen.queryByTestId('body-height-note', { includeHiddenElements: true })).toBeNull();
    });

    test.each([
      [125, 140, '1.25'],
      [225, 210, '2.25'],
    ])('a saved %i cm shows its true value, rests the thumb at %i and explains why', async (saved, thumb, meters) => {
      await launch(profileRow({ clothing_type: 'feminine', height_cm: saved }));
      await screen.findByText('YOUR BODY');

      const slider = screen.getByTestId('body-height-slider');
      expect(slider.props.value).toBe(thumb);
      expect(screen.getByTestId('body-height-value')).toHaveTextContent(`${meters} m`);
      expect(slider.props.accessibilityValue).toEqual({ min: 140, max: 210, now: thumb, text: `${meters} meters` });
      expect(slider.props.accessibilityIncrements).toBeUndefined();
      const note = translate('en', 'onboarding.body.heightOutOfRange', { min: '1.40', max: '2.10' });
      // The visible note is hidden from screen readers, which hear it as the slider's hint instead.
      expect(screen.getByTestId('body-height-note', { includeHiddenElements: true })).toHaveTextContent(note);
      expect(slider.props.accessibilityHint).toBe(note);

      // Untouched, the true value is what gets saved — never the clamped thumb position.
      await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
      await waitFor(() => {
        expect(mockedSaveProfile).toHaveBeenCalledWith(USER_ID, expect.objectContaining({ height_cm: saved }));
      });
    });

    test('moving the thumb from an out-of-range height replaces it and hides the note', async () => {
      await launch(profileRow({ clothing_type: 'feminine', height_cm: 125 }));
      await screen.findByText('YOUR BODY');

      await fireEvent(screen.getByTestId('body-height-slider'), 'valueChange', 150);

      expect(screen.getByTestId('body-height-value')).toHaveTextContent('1.50 m');
      expect(screen.queryByTestId('body-height-note', { includeHiddenElements: true })).toBeNull();
    });
  });
});
