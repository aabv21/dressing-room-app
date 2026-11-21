import { getLocales } from 'expo-localization';

import {
  COMMON_CURRENCIES,
  costPerWear,
  currencyChoices,
  deviceCurrency,
  formatMoney,
  MAX_PRICE,
  parsePrice,
  priceOf,
  priceText,
} from '../price';

jest.mock('expo-localization', () => ({ getLocales: jest.fn() }));

const mockedGetLocales = jest.mocked(getLocales);

/** Intl puts non-breaking spaces between amount and code; compare with plain ones. */
const plain = (text: string): string => text.replace(/\s/g, ' ');

function deviceWith(currencyCode: string | null): void {
  mockedGetLocales.mockReturnValue([
    { languageTag: 'es-CO', languageCode: 'es', regionCode: 'CO', currencyCode } as ReturnType<typeof getLocales>[number],
  ]);
}

describe('parsePrice', () => {
  test.each([
    ['49', 49],
    ['49.90', 49.9],
    ['49,90', 49.9],
    ['49.9', 49.9],
    [' 12,5 ', 12.5],
    ['250.000', 250000],
    ['250,000', 250000],
    ['1.200.000', 1200000],
    ['1,200,000.50', 1200000.5],
    ['1.200.000,50', 1200000.5],
    ['0', 0],
  ])('%j reads %d', (text, expected) => {
    expect(parsePrice(text)).toBe(expected);
  });

  test('an empty field is no price', () => {
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('   ')).toBeNull();
  });

  test.each(['abc', '12a', '-5', '1.2.3,4,5', '12.', ',5', '12.345.6', '1,2345'])('%j is invalid', (text) => {
    expect(parsePrice(text)).toBe('invalid');
  });

  test('a price over what numeric(10,2) holds is invalid', () => {
    expect(parsePrice('99999999.99')).toBe(MAX_PRICE);
    expect(parsePrice('100000000')).toBe('invalid');
  });
});

describe('priceText', () => {
  test('shows a stored price in the locale, with two decimals only when it has cents', () => {
    expect(priceText(49.9, 'en')).toBe('49.90');
    expect(priceText(49.9, 'es')).toBe('49,90');
    expect(priceText(250000, 'es')).toBe('250000');
    expect(priceText(null, 'en')).toBe('');
  });

  test('round-trips through parsePrice', () => {
    for (const value of [0, 12.5, 49.9, 250000, 1200000.5]) {
      expect(parsePrice(priceText(value, 'es'))).toBe(value);
      expect(parsePrice(priceText(value, 'en'))).toBe(value);
    }
  });
});

describe('costPerWear', () => {
  test('divides by the wear count, counting a never-worn piece as one wear', () => {
    expect(costPerWear(30, 12)).toBe(2.5);
    expect(costPerWear(30, 1)).toBe(30);
    expect(costPerWear(30, 0)).toBe(30);
  });
});

describe('formatMoney', () => {
  test('formats in the app locale and the garment currency', () => {
    expect(plain(formatMoney(2.5, 'USD', 'en'))).toBe('$2.50');
    expect(plain(formatMoney(250000, 'COP', 'es'))).toBe('250.000 COP');
    expect(plain(formatMoney(3.33, 'EUR', 'es'))).toBe('3,33 €');
  });
});

describe('deviceCurrency', () => {
  test("is the device's first locale currency", () => {
    deviceWith('COP');
    expect(deviceCurrency()).toBe('COP');
  });

  test('falls back to USD when the device has none or an odd one', () => {
    deviceWith(null);
    expect(deviceCurrency()).toBe('USD');
    deviceWith('peso');
    expect(deviceCurrency()).toBe('USD');
  });
});

describe('currencyChoices', () => {
  test('is the common codes', () => {
    expect(currencyChoices()).toEqual([...COMMON_CURRENCIES]);
    expect(COMMON_CURRENCIES).toEqual(['USD', 'COP', 'MXN', 'EUR', 'VES', 'ARS', 'CLP', 'PEN', 'BRL']);
  });

  test('puts a code outside them first, once', () => {
    expect(currencyChoices('GBP', 'GBP', 'COP', null)).toEqual(['GBP', ...COMMON_CURRENCIES]);
  });
});

describe('priceOf', () => {
  test('is the price and currency when both are set', () => {
    expect(priceOf({ price: 30, currency: 'USD' })).toEqual({ price: 30, currency: 'USD' });
    expect(priceOf({ price: 0, currency: 'COP' })).toEqual({ price: 0, currency: 'COP' });
  });

  test('is null for an unpriced row, or one an older build cached without the columns', () => {
    expect(priceOf({ price: null, currency: null })).toBeNull();
    expect(priceOf({})).toBeNull();
  });
});
