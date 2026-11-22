// Open-Meteo URLs, response parsing, the weather bands and the location cache key. Never fetches,
// so its tests never reach the real service.

import { isRecord } from './guards.ts';

export type WeatherBand = 'cold' | 'cool' | 'mild' | 'hot';

export type WeatherCondition = 'clear' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm';

export type WeatherSummary = {
  tempC: number;
  condition: WeatherCondition;
  band: WeatherBand;
  rain: boolean;
};

/** The forecast request for today's current conditions and daily range (see docs/ai.md). */
export function forecastUrl(base: string, lat: number, lon: number): string {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,weather_code',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: '1',
  });
  return `${base}?${params.toString()}`;
}

/** How many days Open-Meteo forecasts, today included: its `forecast_days` maximum. */
export const FORECAST_DAYS = 16;

/** The daily forecast request for a trip: each day's range, rain chance and weather code. */
export function dailyForecastUrl(base: string, lat: number, lon: number): string {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code',
    timezone: 'auto',
    forecast_days: String(FORECAST_DAYS),
  });
  return `${base}?${params.toString()}`;
}

/** The geocoding request for a free-text city name, taking the single best match (names in `language`). */
export function geocodeUrl(base: string, name: string, language?: string): string {
  const params = new URLSearchParams({ name, count: '1', format: 'json', ...(language === undefined ? {} : { language }) });
  return `${base}?${params.toString()}`;
}

function firstNumber(value: unknown): number | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const first: unknown = value[0];
  return typeof first === 'number' ? first : null;
}

/** Daily mean of `(max + min) / 2`: below 12 cold, below 18 cool, below 24 mild, otherwise hot. */
export function bandOf(maxC: number, minC: number): WeatherBand {
  const mean = (maxC + minC) / 2;
  if (mean < 12) return 'cold';
  if (mean < 18) return 'cool';
  if (mean < 24) return 'mild';
  return 'hot';
}

/** WMO weather-code buckets (open-meteo.com/en/docs). */
export function conditionOf(code: number): WeatherCondition {
  if (code <= 1) return 'clear';
  if (code <= 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return 'snow';
  if (code >= 95 && code <= 99) return 'storm';
  return 'clear';
}

/** `null` if any needed field is missing or mistyped; never throws (an untrusted response). */
export function parseForecast(body: unknown): WeatherSummary | null {
  if (!isRecord(body)) return null;

  const current = body.current;
  if (!isRecord(current)) return null;
  const tempC = current.temperature_2m;
  const weatherCode = current.weather_code;
  if (typeof tempC !== 'number' || typeof weatherCode !== 'number') return null;

  const daily = body.daily;
  if (!isRecord(daily)) return null;
  const maxC = firstNumber(daily.temperature_2m_max);
  const minC = firstNumber(daily.temperature_2m_min);
  const precipitationProbability = firstNumber(daily.precipitation_probability_max);
  if (maxC === null || minC === null || precipitationProbability === null) return null;

  const condition = conditionOf(weatherCode);
  const rain = precipitationProbability >= 50 || condition === 'rain' || condition === 'storm';

  return { tempC, condition, band: bandOf(maxC, minC), rain };
}

/**
 * Each forecast day (`YYYY-MM-DD`, the place's own calendar) to its summary, the high as `tempC`;
 * a day with any value missing is left out. `null` when the body isn't a daily forecast.
 */
export function parseDailyForecast(body: unknown): Map<string, WeatherSummary> | null {
  if (!isRecord(body) || !isRecord(body.daily)) return null;
  const { time, temperature_2m_max: highs, temperature_2m_min: lows, precipitation_probability_max: rains, weather_code: codes } =
    body.daily;
  if (!Array.isArray(time) || !Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(rains) || !Array.isArray(codes)) {
    return null;
  }
  const days = new Map<string, WeatherSummary>();
  const at = (values: unknown[], index: number): unknown => values.at(index);
  (time as unknown[]).forEach((date, index) => {
    const maxC = at(highs as unknown[], index);
    const minC = at(lows as unknown[], index);
    const rainChance = at(rains as unknown[], index);
    const code = at(codes as unknown[], index);
    if (typeof date !== 'string' || typeof maxC !== 'number' || typeof minC !== 'number') return;
    if (typeof rainChance !== 'number' || typeof code !== 'number') return;
    const condition = conditionOf(code);
    const rain = rainChance >= 50 || condition === 'rain' || condition === 'storm';
    days.set(date, { tempC: maxC, condition, band: bandOf(maxC, minC), rain });
  });
  return days;
}

/** The first geocoding result with its display name and country, or `null` when there is none. */
export function parsePlace(body: unknown): { lat: number; lon: number; name: string; country: string | null } | null {
  const coords = parseGeocode(body);
  if (coords === null || !isRecord(body) || !Array.isArray(body.results)) return null;
  const first: unknown = body.results[0];
  if (!isRecord(first) || typeof first.name !== 'string') return null;
  return { ...coords, name: first.name, country: typeof first.country === 'string' ? first.country : null };
}

/** Maps a geocoding response body to the first result's coordinates, or `null` if there is none. */
export function parseGeocode(body: unknown): { lat: number; lon: number } | null {
  if (!isRecord(body)) return null;
  const results = body.results;
  if (!Array.isArray(results) || results.length === 0) return null;
  const first: unknown = results[0];
  if (!isRecord(first)) return null;
  const lat = first.latitude;
  const lon = first.longitude;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  return { lat, lon };
}

/** Coordinates (rounded to ~1 km) when known, else a normalized name, else `null`. */
export function locationKey(city: { name: string | null; lat: number | null; lon: number | null }): string | null {
  if (city.lat !== null && city.lon !== null) {
    return `${city.lat.toFixed(2)},${city.lon.toFixed(2)}`;
  }
  const trimmed = city.name?.trim();
  if (trimmed) {
    return `city:${trimmed.toLowerCase()}`;
  }
  return null;
}
