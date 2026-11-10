/** @jest-environment node */
// supabase/functions/_shared/__tests__/weather.test.ts
import {
  bandOf,
  conditionOf,
  forecastUrl,
  geocodeUrl,
  locationKey,
  parseForecast,
  parseGeocode,
} from '../weather.ts';

describe('forecastUrl', () => {
  test('builds the Open-Meteo forecast query', () => {
    const url = forecastUrl('https://api.open-meteo.com/v1', -34.6, -58.38);
    expect(url).toBe(
      'https://api.open-meteo.com/v1?latitude=-34.6&longitude=-58.38&current=temperature_2m%2Cweather_code&daily=temperature_2m_max%2Ctemperature_2m_min%2Cprecipitation_probability_max&timezone=auto&forecast_days=1',
    );
  });
});

describe('geocodeUrl', () => {
  test('builds the Open-Meteo geocoding query', () => {
    const url = geocodeUrl('https://geocoding-api.open-meteo.com/v1/search', 'Buenos Aires');
    expect(url).toBe('https://geocoding-api.open-meteo.com/v1/search?name=Buenos+Aires&count=1&format=json');
  });
});

describe('bandOf', () => {
  test('mean 9 (14/4) is cold', () => {
    expect(bandOf(14, 4)).toBe('cold');
  });

  test('mean 17 (20/14) is cool', () => {
    expect(bandOf(20, 14)).toBe('cool');
  });

  test('mean 23 (26/20) is mild', () => {
    expect(bandOf(26, 20)).toBe('mild');
  });

  test('mean 27 (32/22) is hot', () => {
    expect(bandOf(32, 22)).toBe('hot');
  });
});

describe('conditionOf', () => {
  test.each([
    [0, 'clear'],
    [3, 'cloudy'],
    [45, 'fog'],
    [61, 'rain'],
    [80, 'rain'],
    [73, 'snow'],
    [95, 'storm'],
  ] as const)('code %i -> %s', (code, expected) => {
    expect(conditionOf(code)).toBe(expected);
  });
});

/** A realistic Open-Meteo `/v1/forecast` body (see https://open-meteo.com/en/docs). */
function forecastBody(overrides: {
  weatherCode?: number;
  precipitationProbabilityMax?: number;
  tempMax?: number;
  tempMin?: number;
}): unknown {
  return {
    latitude: -34.6,
    longitude: -58.38,
    generationtime_ms: 0.123,
    utc_offset_seconds: -10800,
    timezone: 'America/Argentina/Buenos_Aires',
    timezone_abbreviation: '-03',
    elevation: 25,
    current_units: { time: 'iso8601', interval: 'seconds', temperature_2m: '°C', weather_code: 'wmo code' },
    current: {
      time: '2026-11-08T12:00',
      interval: 900,
      temperature_2m: 23.4,
      weather_code: overrides.weatherCode ?? 1,
    },
    daily_units: {
      time: 'iso8601',
      temperature_2m_max: '°C',
      temperature_2m_min: '°C',
      precipitation_probability_max: '%',
    },
    daily: {
      time: ['2026-11-08'],
      temperature_2m_max: [overrides.tempMax ?? 26],
      temperature_2m_min: [overrides.tempMin ?? 18],
      precipitation_probability_max: [overrides.precipitationProbabilityMax ?? 10],
    },
  };
}

describe('parseForecast', () => {
  test('a recorded Open-Meteo body maps to a WeatherSummary', () => {
    const body = forecastBody({ weatherCode: 1, tempMax: 26, tempMin: 18, precipitationProbabilityMax: 10 });
    expect(parseForecast(body)).toEqual({
      tempC: 23.4,
      condition: 'clear',
      band: 'mild',
      rain: false,
    });
  });

  test('a precipitation probability of 60 is rain', () => {
    const body = forecastBody({ precipitationProbabilityMax: 60 });
    expect(parseForecast(body)).toMatchObject({ rain: true });
  });

  test('a current weather code of rain is rain even with low precipitation probability', () => {
    const body = forecastBody({ weatherCode: 61, precipitationProbabilityMax: 5 });
    expect(parseForecast(body)).toMatchObject({ rain: true, condition: 'rain' });
  });

  test('a body missing daily is null', () => {
    const body = forecastBody({});
    delete (body as Record<string, unknown>).daily;
    expect(parseForecast(body)).toBeNull();
  });

  test('a body missing current is null', () => {
    const body = forecastBody({});
    delete (body as Record<string, unknown>).current;
    expect(parseForecast(body)).toBeNull();
  });

  test('a non-record body is null', () => {
    expect(parseForecast(null)).toBeNull();
    expect(parseForecast('nope')).toBeNull();
  });

  test('a daily array missing its first entry is null', () => {
    const body = forecastBody({}) as { daily: { temperature_2m_max: number[] } };
    body.daily.temperature_2m_max = [];
    expect(parseForecast(body)).toBeNull();
  });
});

describe('parseGeocode', () => {
  test('a result with coordinates maps to lat/lon', () => {
    const body = { results: [{ id: 1, name: 'Buenos Aires', latitude: -34.6037, longitude: -58.3816 }] };
    expect(parseGeocode(body)).toEqual({ lat: -34.6037, lon: -58.3816 });
  });

  test('an empty results array is null', () => {
    expect(parseGeocode({ results: [] })).toBeNull();
  });

  test('a body with no results field is null', () => {
    expect(parseGeocode({})).toBeNull();
  });

  test('a non-record body is null', () => {
    expect(parseGeocode(null)).toBeNull();
  });
});

describe('locationKey', () => {
  test('coordinates take priority and are formatted to 2 decimals', () => {
    expect(locationKey({ name: 'Buenos Aires', lat: -34.6037, lon: -58.3816 })).toBe('-34.60,-58.38');
  });

  test('a name only falls back to a lowercased city key', () => {
    expect(locationKey({ name: 'Buenos Aires', lat: null, lon: null })).toBe('city:buenos aires');
  });

  test('nothing at all is null', () => {
    expect(locationKey({ name: null, lat: null, lon: null })).toBeNull();
  });

  test('a blank name is treated as nothing', () => {
    expect(locationKey({ name: '   ', lat: null, lon: null })).toBeNull();
  });

  test('only one coordinate present falls back to name', () => {
    expect(locationKey({ name: 'Buenos Aires', lat: -34.6037, lon: null })).toBe('city:buenos aires');
  });
});
