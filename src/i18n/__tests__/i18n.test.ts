import { en } from '../en';
import { es } from '../es';
import { formatWearCount, resolveLocale, translate } from '../index';

test('es has exactly the en keys', () => {
  expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
});

test.each([
  [['es-CO'], 'es'], [['es'], 'es'], [['en-US'], 'en'],
  [['pt-BR'], 'en'], [['fr-FR', 'es-MX'], 'es'], [[], 'en'],
])('resolveLocale(%j) → %s', (tags, expected) => {
  expect(resolveLocale(tags)).toBe(expected);
});

test.each([
  [0, 'en', 'never worn'], [1, 'en', '1 wear'], [2, 'en', '2 wears'], [1000, 'en', '1,000 wears'],
  [0, 'es', 'sin usar'], [1, 'es', '1 uso'], [2, 'es', '2 usos'], [1000, 'es', '1000 usos'],
] as const)('formatWearCount(%i, %s) → %s', (n, locale, expected) => {
  expect(formatWearCount(n, locale)).toBe(expected);
});

test('translate interpolates params and never returns a raw key for a known key', () => {
  expect(translate('es', 'tabs.closet')).toBe('Clóset');
  expect(translate('en', 'grid.empty', { count: 10 })).toBe('Add your 10 favorites to get started.');
});
