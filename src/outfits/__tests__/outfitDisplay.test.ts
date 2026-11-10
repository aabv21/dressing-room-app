import { translate } from '../../i18n';
import { formatWeather, orderPieces, pieceLabel, SLOT_ORDER } from '../outfitDisplay';
import type { WeatherSummary } from '../types';

describe('SLOT_ORDER', () => {
  test('is the slots in display order', () => {
    expect(SLOT_ORDER).toEqual(['outerwear', 'top', 'one_piece', 'bottom', 'shoes', 'bag', 'headwear', 'accessory']);
  });
});

describe('orderPieces', () => {
  test('puts a blazer (outerwear) before a blouse (top), and shoes last', () => {
    const blazer = { category: 'blazer' as const };
    const blouse = { category: 'blouse' as const };
    const shoes = { category: 'shoes' as const };
    const jeans = { category: 'jeans' as const };

    const ordered = orderPieces([shoes, blouse, jeans, blazer]);

    expect(ordered).toEqual([blazer, blouse, jeans, shoes]);
  });

  test('a piece with no category sorts last, after every known slot', () => {
    const shoes = { category: 'shoes' as const };
    const unknown = { category: null };

    expect(orderPieces([unknown, shoes])).toEqual([shoes, unknown]);
  });

  test('is stable for pieces sharing a slot', () => {
    const bag = { category: 'bag' as const, id: 'a' };
    const hat = { category: 'hat' as const, id: 'b' };

    expect(orderPieces([bag, hat])).toEqual([bag, hat]);
  });
});

describe('pieceLabel', () => {
  test('is the category label plus the first color label, in es', () => {
    const garment = { category: 't_shirt' as const, colors: ['blue' as const, 'navy' as const] };

    expect(pieceLabel(garment, (key) => translate('es', key))).toBe('Franela · Azul');
  });

  test('is the category label plus the first color label, in en', () => {
    const garment = { category: 'blouse' as const, colors: ['white' as const] };

    expect(pieceLabel(garment, (key) => translate('en', key))).toBe('Blouse · White');
  });

  test('a piece with no category yet is the unnamed label plus its color', () => {
    const garment = { category: null, colors: ['black' as const] };

    expect(pieceLabel(garment, (key) => translate('en', key))).toBe(`${translate('en', 'garment.unnamed')} · Black`);
  });

  test('a piece with no colors is the category label alone', () => {
    const garment = { category: 'jeans' as const, colors: [] };

    expect(pieceLabel(garment, (key) => translate('en', key))).toBe('Jeans');
    expect(pieceLabel({ category: null, colors: [] }, (key) => translate('es', key))).toBe(translate('es', 'garment.unnamed'));
  });
});

describe('formatWeather', () => {
  const TUESDAY = new Date(2026, 10, 10, 12, 0); // 2026-11-10 is a Tuesday

  test('es, Tuesday, 24 °C clear gives "Martes · 24 °C, soleado"', () => {
    const weather: WeatherSummary = { tempC: 24, condition: 'clear', band: 'mild', rain: false };

    expect(formatWeather(weather, 'es', TUESDAY)).toBe('Martes · 24 °C, soleado');
  });

  test('en, Tuesday, 24 °C clear', () => {
    const weather: WeatherSummary = { tempC: 24, condition: 'clear', band: 'mild', rain: false };

    expect(formatWeather(weather, 'en', TUESDAY)).toBe('Tuesday · 24 °C, sunny');
  });

  test('rounds the temperature', () => {
    const weather: WeatherSummary = { tempC: 23.6, condition: 'rain', band: 'mild', rain: true };

    expect(formatWeather(weather, 'en', TUESDAY)).toBe('Tuesday · 24 °C, rainy');
  });

  test('null weather gives null', () => {
    expect(formatWeather(null, 'en', TUESDAY)).toBeNull();
  });
});
