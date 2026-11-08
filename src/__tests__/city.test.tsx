// The city modal pushed from Today's weather line: the profile's city prefilled, "use my location"
// and Save. Rendered directly with auth, the profile repository, expo-location and the router mocked.
import { fireEvent, render, screen } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { router } from 'expo-router';

import CityScreen from '../app/city';
import { getProfile, saveProfile, type Profile } from '../profile/profileRepository';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn() },
}));

jest.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ userId: 'user-1' }),
}));

jest.mock('../profile/profileRepository', () => ({
  getProfile: jest.fn(),
  saveProfile: jest.fn(),
}));

jest.mock('expo-location', () => ({
  Accuracy: { Low: 2 },
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
}));

const mockedGetProfile = jest.mocked(getProfile);
const mockedSaveProfile = jest.mocked(saveProfile);

function profile(overrides: Partial<Profile> = {}): Profile {
  return { city_name: 'Madrid', city_lat: 40.42, city_lon: -3.7, ...overrides } as Profile;
}

beforeEach(() => {
  mockedGetProfile.mockReset();
  mockedSaveProfile.mockReset();
  mockedSaveProfile.mockResolvedValue({ ok: true });
  jest.mocked(router.back).mockClear();
  jest.mocked(router.replace).mockClear();
  jest.mocked(router.canGoBack).mockReturnValue(true);
});

test('prefills the field with the profile city', async () => {
  mockedGetProfile.mockResolvedValue(profile());
  await render(<CityScreen />);

  expect(await screen.findByDisplayValue('Madrid')).toBeOnTheScreen();
  expect(screen.getByText('YOUR CITY')).toBeOnTheScreen();
});

test('a typed city is saved by name with no coordinates, then the modal closes', async () => {
  mockedGetProfile.mockResolvedValue(profile());
  await render(<CityScreen />);

  await fireEvent.changeText(await screen.findByDisplayValue('Madrid'), '  Lima ');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

  expect(mockedSaveProfile).toHaveBeenCalledTimes(1);
  expect(mockedSaveProfile).toHaveBeenCalledWith('user-1', { city_name: 'Lima', city_lat: null, city_lon: null });
  expect(router.back).toHaveBeenCalledTimes(1);
});

test('"use my location" fills the city, and Save stores its coordinates', async () => {
  mockedGetProfile.mockResolvedValue(profile({ city_name: null, city_lat: null, city_lon: null }));
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
  mockedGetProfile.mockResolvedValue(profile());
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({
    status: Location.PermissionStatus.DENIED,
  } as Location.LocationPermissionResponse);
  await render(<CityScreen />);

  await fireEvent.press(await screen.findByRole('button', { name: 'use my location' }));
  expect(await screen.findByText('Location access is off. Type your city instead.')).toBeOnTheScreen();
  expect(mockedSaveProfile).not.toHaveBeenCalled();
});

test('an unchanged city closes without saving', async () => {
  mockedGetProfile.mockResolvedValue(profile());
  await render(<CityScreen />);

  await screen.findByDisplayValue('Madrid');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

  expect(mockedSaveProfile).not.toHaveBeenCalled();
  expect(router.back).toHaveBeenCalledTimes(1);
});

test('a failed save shows the error and keeps the modal open', async () => {
  mockedGetProfile.mockResolvedValue(profile());
  mockedSaveProfile.mockResolvedValue({ ok: false, error: 'profile.error.network' });
  await render(<CityScreen />);

  await fireEvent.changeText(await screen.findByDisplayValue('Madrid'), 'Lima');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

  expect(await screen.findByText("Couldn't save. Check your internet and try again.")).toBeOnTheScreen();
  expect(router.back).not.toHaveBeenCalled();
});

test('a failed profile read offers a retry instead of an empty field', async () => {
  mockedGetProfile.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(profile());
  await render(<CityScreen />);

  await fireEvent.press(await screen.findByRole('button', { name: 'Try again' }));
  expect(await screen.findByDisplayValue('Madrid')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Save' })).toBeOnTheScreen();
});

test('the close button goes back', async () => {
  mockedGetProfile.mockResolvedValue(profile());
  await render(<CityScreen />);

  await fireEvent.press(await screen.findByRole('button', { name: 'Close' }));
  expect(router.back).toHaveBeenCalledTimes(1);
});
