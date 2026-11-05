import * as Location from 'expo-location';
import { useCallback } from 'react';

export type CurrentCity = { name: string; lat: number; lon: number };
export type CurrentCityResult = { ok: true; city: CurrentCity } | { ok: false; error: 'denied' | 'unavailable' };

/**
 * Asks for when-in-use location permission, reads the current position once and reverse-geocodes
 * it to a city name (`city ?? subregion ?? region`). Only the city and its coordinates are kept, for
 * weather; nothing is tracked.
 */
export function useCurrentCity(): { request: () => Promise<CurrentCityResult> } {
  const request = useCallback(async (): Promise<CurrentCityResult> => {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== Location.PermissionStatus.GRANTED) {
        return { ok: false, error: 'denied' };
      }
      // City-level accuracy is all the weather lookup needs, and it resolves faster.
      const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
      const [address] = await Location.reverseGeocodeAsync({ latitude: coords.latitude, longitude: coords.longitude });
      const name = address?.city ?? address?.subregion ?? address?.region ?? null;
      if (name === null || name.trim() === '') {
        return { ok: false, error: 'unavailable' };
      }
      return { ok: true, city: { name, lat: coords.latitude, lon: coords.longitude } };
    } catch {
      return { ok: false, error: 'unavailable' };
    }
  }, []);

  return { request };
}
