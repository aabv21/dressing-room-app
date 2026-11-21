// The city modal pushed from Today's weather line: the profile's city prefilled, "use my location"
// and Save. Rendered directly with auth, the profile repository, expo-location and the router mocked.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { Linking } from 'react-native';

import CityScreen from '../app/city';
import { saveProfile, type Profile } from '../profile/profileRepository';
import { resetAuth, setAuth } from '../test/authMock';
import { emitRecognition, hear, recognition } from '../test/dictation';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return -- jest.mock()'s factory can only reference globals (incl. `require`), not a module-scoped import
jest.mock('../auth/AuthProvider', () => require('../test/authMock'));

jest.mock('../profile/profileRepository', () => ({
  saveProfile: jest.fn(),
}));

jest.mock('expo-location', () => ({
  Accuracy: { Low: 2 },
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
}));

const mockedSaveProfile = jest.mocked(saveProfile);

function profile(overrides: Partial<Profile> = {}): Profile {
  return { city_name: 'Madrid', city_lat: 40.42, city_lon: -3.7, ...overrides } as Profile;
}

beforeEach(() => {
  resetAuth();
  mockedSaveProfile.mockReset();
  mockedSaveProfile.mockResolvedValue({ ok: true });
  jest.mocked(router.back).mockClear();
  jest.mocked(router.replace).mockClear();
  jest.mocked(router.canGoBack).mockReturnValue(true);
});

test('prefills the field with the profile city', async () => {
  setAuth({ profile: profile() });
  await render(<CityScreen />);

  expect(await screen.findByDisplayValue('Madrid')).toBeOnTheScreen();
  expect(screen.getByText('YOUR CITY')).toBeOnTheScreen();
});

test('a typed city is saved by name with no coordinates, then the modal closes', async () => {
  setAuth({ profile: profile() });
  await render(<CityScreen />);

  await fireEvent.changeText(await screen.findByDisplayValue('Madrid'), '  Lima ');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

  expect(mockedSaveProfile).toHaveBeenCalledTimes(1);
  expect(mockedSaveProfile).toHaveBeenCalledWith('user-1', { city_name: 'Lima', city_lat: null, city_lon: null });
  expect(router.back).toHaveBeenCalledTimes(1);
});

test('a saved city reaches the shared profile, so Today shows it without another read', async () => {
  const auth = resetAuth({ profile: profile() });
  await render(<CityScreen />);

  await fireEvent.changeText(await screen.findByDisplayValue('Madrid'), 'Lima');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

  expect(auth.replaceProfileLocal).toHaveBeenCalledWith({ city_name: 'Lima', city_lat: null, city_lon: null });
});

test('"use my location" fills the city, and Save stores its coordinates', async () => {
  setAuth({ profile: profile({ city_name: null, city_lat: null, city_lon: null }) });
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({
    status: Location.PermissionStatus.GRANTED,
  } as Location.LocationPermissionResponse);
  jest.mocked(Location.getCurrentPositionAsync).mockResolvedValue({
    coords: { latitude: -12.0464, longitude: -77.0428 },
  } as Location.LocationObject);
  jest.mocked(Location.reverseGeocodeAsync).mockResolvedValue([{ city: 'Lima' } as Location.LocationGeocodedAddress]);
  await render(<CityScreen />);

  await fireEvent.press(await screen.findByRole('button', { name: 'use my location' }));
  expect(await screen.findByDisplayValue('Lima')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

  expect(mockedSaveProfile).toHaveBeenCalledWith('user-1', { city_name: 'Lima', city_lat: -12.05, city_lon: -77.04 });
});

test('a denied location permission says so and saves nothing', async () => {
  setAuth({ profile: profile() });
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({
    status: Location.PermissionStatus.DENIED,
  } as Location.LocationPermissionResponse);
  await render(<CityScreen />);

  await fireEvent.press(await screen.findByRole('button', { name: 'use my location' }));
  expect(await screen.findByText('Location access is off. Type your city instead.')).toBeOnTheScreen();
  expect(mockedSaveProfile).not.toHaveBeenCalled();
});

test('"use my location" is disabled while a save is in flight', async () => {
  setAuth({ profile: profile() });
  jest.mocked(Location.requestForegroundPermissionsAsync).mockClear();
  let finishSave: (value: Awaited<ReturnType<typeof saveProfile>>) => void = () => undefined;
  mockedSaveProfile.mockReturnValue(
    new Promise((resolve) => {
      finishSave = resolve;
    }),
  );
  await render(<CityScreen />);

  await fireEvent.changeText(await screen.findByDisplayValue('Madrid'), 'Lima');
  expect(screen.getByRole('button', { name: 'use my location' })).toBeEnabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

  const locate = screen.getByRole('button', { name: 'use my location' });
  expect(locate).toBeDisabled();
  await fireEvent.press(locate);
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();

  // A failed save keeps the modal open, and the location button works again.
  await act(async () => {
    finishSave({ ok: false, error: 'profile.error.network' });
    await Promise.resolve();
  });
  expect(await screen.findByText("Couldn't save. Check your internet and try again.")).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'use my location' })).toBeEnabled();
});

test('an unchanged city closes without saving', async () => {
  setAuth({ profile: profile() });
  await render(<CityScreen />);

  await screen.findByDisplayValue('Madrid');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

  expect(mockedSaveProfile).not.toHaveBeenCalled();
  expect(router.back).toHaveBeenCalledTimes(1);
});

test('a failed save shows the error and keeps the modal open', async () => {
  setAuth({ profile: profile() });
  mockedSaveProfile.mockResolvedValue({ ok: false, error: 'profile.error.network' });
  await render(<CityScreen />);

  await fireEvent.changeText(await screen.findByDisplayValue('Madrid'), 'Lima');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

  expect(await screen.findByText("Couldn't save. Check your internet and try again.")).toBeOnTheScreen();
  expect(router.back).not.toHaveBeenCalled();
});

test('a failed profile read offers a retry instead of an empty field', async () => {
  const refreshProfile = jest.fn(() => {
    setAuth({ profile: profile(), profileStatus: 'ready' });
    return Promise.resolve(true);
  });
  setAuth({ profile: null, profileStatus: 'error', refreshProfile });
  await render(<CityScreen />);

  await fireEvent.press(await screen.findByRole('button', { name: 'Try again' }));
  expect(await screen.findByDisplayValue('Madrid')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Save' })).toBeOnTheScreen();
});

test('the close button goes back', async () => {
  setAuth({ profile: profile() });
  await render(<CityScreen />);

  await fireEvent.press(await screen.findByRole('button', { name: 'Close' }));
  expect(router.back).toHaveBeenCalledTimes(1);
});

describe('dictating the city', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    recognition.isRecognitionAvailable.mockReturnValue(true);
  });

  test('the mic asks for the microphone, listens on the device in the app language, and fills the field', async () => {
    setAuth({ profile: profile() });
    await render(<CityScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: 'Dictate the city' }));

    expect(recognition.requestPermissionsAsync).toHaveBeenCalled();
    expect(recognition.start).toHaveBeenCalledWith(
      expect.objectContaining({ lang: 'en-US', interimResults: false, continuous: false }),
    );
    expect(screen.getByRole('button', { name: 'Stop listening' })).toBeOnTheScreen();

    await act(() => {
      hear('Medellín');
    });

    expect(screen.getByDisplayValue('Medellín')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Dictate the city' })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(mockedSaveProfile).toHaveBeenCalledWith('user-1', { city_name: 'Medellín', city_lat: null, city_lon: null });
  });

  test('a second tap stops listening', async () => {
    setAuth({ profile: profile() });
    await render(<CityScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Dictate the city' }));

    await fireEvent.press(screen.getByRole('button', { name: 'Stop listening' }));

    expect(recognition.stop).toHaveBeenCalled();
  });

  test('a denied microphone explains itself and never starts', async () => {
    recognition.requestPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: false, status: 'denied', expires: 'never' });
    setAuth({ profile: profile() });
    await render(<CityScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: 'Dictate the city' }));

    expect(
      await screen.findByText('Microphone access is off for Dressing Room. Turn it on in Settings to dictate.'),
    ).toBeOnTheScreen();
    expect(recognition.start).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Madrid')).toBeOnTheScreen();

    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await fireEvent.press(screen.getByRole('link', { name: 'Open settings' }));
    expect(openSettings).toHaveBeenCalled();
  });

  test('nothing heard keeps the field and says so', async () => {
    setAuth({ profile: profile() });
    await render(<CityScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Dictate the city' }));

    await act(() => {
      emitRecognition('error', { error: 'no-speech', message: '' });
      emitRecognition('end');
    });

    expect(screen.getByText("Didn't catch that. Try again.")).toBeOnTheScreen();
    expect(screen.getByDisplayValue('Madrid')).toBeOnTheScreen();
  });

  test('no mic when the phone has no speech recognition', async () => {
    recognition.isRecognitionAvailable.mockReturnValue(false);
    setAuth({ profile: profile() });
    await render(<CityScreen />);

    await screen.findByDisplayValue('Madrid');
    expect(screen.queryByRole('button', { name: 'Dictate the city' })).not.toBeOnTheScreen();
  });

  test('closing the modal while listening aborts the recognizer', async () => {
    setAuth({ profile: profile() });
    const view = await render(<CityScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Dictate the city' }));

    await view.unmount();

    expect(recognition.abort).toHaveBeenCalled();
  });
});
