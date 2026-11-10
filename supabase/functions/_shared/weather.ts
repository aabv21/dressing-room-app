// Open-Meteo request URLs and response parsing: forecast/geocoding query builders, the WMO
// weather-code and temperature-band mappings, and the location cache key.
//
// Runtime-neutral (no imports, nothing Deno- or Node-only) so Jest exercises it under Node and
// the Edge Function runs it under Deno. It builds URLs and parses responses but never fetches, so
// its tests never reach the real Open-Meteo service.

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

/** The geocoding request for a free-text city name, taking the single best match. */
export function geocodeUrl(base: string, name: string): string {
  const params = new URLSearchParams({ name, count: '1', format: 'json' });
  return `${base}?${params.toString()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

/**
 * Maps a `/v1/forecast` response body to a `WeatherSummary`, or `null` if any field needed is
 * missing or the wrong shape. Never throws: the body is an untrusted network response.
 */
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

/**
 * The weather/lucky cache key for a city: coordinates (rounded to ~1 km) when known, else a
 * normalized name, else `null` when there is no location at all.
 */
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
