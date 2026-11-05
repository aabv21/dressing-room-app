jest.mock('expo-location', () => ({
  Accuracy: { Low: 2 },
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
}));

import { renderHook } from '@testing-library/react-native';
import * as Location from 'expo-location';

import { useCurrentCity } from '../useCurrentCity';

const requestPermission = jest.mocked(Location.requestForegroundPermissionsAsync);
const getPosition = jest.mocked(Location.getCurrentPositionAsync);
const reverseGeocode = jest.mocked(Location.reverseGeocodeAsync);

function granted(isGranted: boolean) {
  const status = isGranted ? Location.PermissionStatus.GRANTED : Location.PermissionStatus.DENIED;
  return { status, granted: isGranted } as Awaited<ReturnType<typeof Location.requestForegroundPermissionsAsync>>;
}

function position(latitude: number, longitude: number) {
  return { coords: { latitude, longitude } } as Awaited<ReturnType<typeof Location.getCurrentPositionAsync>>;
}

function address(fields: { city?: string | null; subregion?: string | null; region?: string | null }) {
  return [{ city: null, subregion: null, region: null, ...fields }] as Awaited<ReturnType<typeof Location.reverseGeocodeAsync>>;
}

async function request() {
  const { result } = await renderHook(() => useCurrentCity());
  return result.current.request();
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('denied permission resolves to denied without reading the position', async () => {
  requestPermission.mockResolvedValue(granted(false));

  expect(await request()).toEqual({ ok: false, error: 'denied' });
  expect(getPosition).not.toHaveBeenCalled();
});

test('reverse-geocodes the position to the city name', async () => {
  requestPermission.mockResolvedValue(granted(true));
  getPosition.mockResolvedValue(position(4.711, -74.0721));
  reverseGeocode.mockResolvedValue(address({ city: 'Bogotá', subregion: 'Bogotá D.C.', region: 'Bogotá' }));

  expect(await request()).toEqual({ ok: true, city: { name: 'Bogotá', lat: 4.711, lon: -74.0721 } });
  expect(reverseGeocode).toHaveBeenCalledWith({ latitude: 4.711, longitude: -74.0721 });
});

test('falls back to subregion, then region', async () => {
  requestPermission.mockResolvedValue(granted(true));
  getPosition.mockResolvedValue(position(1, 2));
  reverseGeocode.mockResolvedValueOnce(address({ subregion: 'Chacao', region: 'Miranda' }));
  reverseGeocode.mockResolvedValueOnce(address({ region: 'Miranda' }));

  expect(await request()).toEqual({ ok: true, city: { name: 'Chacao', lat: 1, lon: 2 } });
  expect(await request()).toEqual({ ok: true, city: { name: 'Miranda', lat: 1, lon: 2 } });
});

test('no address or a thrown error resolves to unavailable', async () => {
  requestPermission.mockResolvedValue(granted(true));
  getPosition.mockResolvedValue(position(1, 2));
  reverseGeocode.mockResolvedValueOnce([]);
  expect(await request()).toEqual({ ok: false, error: 'unavailable' });

  getPosition.mockRejectedValueOnce(new Error('Location services are disabled'));
  expect(await request()).toEqual({ ok: false, error: 'unavailable' });
});
