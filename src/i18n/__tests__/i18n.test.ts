import { RATING_DIMENSIONS, type RatingLabel } from '../../../supabase/functions/_shared/rating.ts';

import { en } from '../en';
import { es } from '../es';
import { formatWearCount, pluralKey, resolveLocale, translate } from '../index';

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

test('number params reuse one Intl.NumberFormat per locale', () => {
  const spy = jest.spyOn(Intl, 'NumberFormat');
  try {
    for (let i = 0; i < 3; i += 1) {
      expect(translate('en', 'wear.other', { count: 1000 + i })).toBe(`1,00${String(i)} wears`);
      expect(translate('es', 'wear.other', { count: 2000 + i })).toBe(`200${String(i)} usos`);
    }
    // At most one construction per locale (zero if an earlier test already warmed the cache).
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
  } finally {
    spy.mockRestore();
  }
});

test.each([
  ['closet.processing', 1, 'closet.processing.one'],
  ['closet.processing', 3, 'closet.processing.other'],
  ['closet.failed', 0, 'closet.failed.other'],
  ['closet.reviewBanner', 1, 'closet.reviewBanner.one'],
] as const)('pluralKey(%s, %i) → %s', (base, count, expected) => {
  expect(pluralKey(base, count)).toBe(expected);
  expect(translate('en', pluralKey(base, count), { count })).not.toContain('{');
});

test('every rating reason and label the functions send has a message', () => {
  const keys: ReadonlySet<string> = new Set(Object.keys(en));
  for (const dimension of RATING_DIMENSIONS) {
    expect(keys).toContain(`rating.reason.${dimension}.good`);
    expect(keys).toContain(`rating.reason.${dimension}.warn`);
  }
  for (const label of ['great', 'good', 'fair', 'poor'] satisfies RatingLabel[]) {
    expect(keys).toContain(`rating.label.${label}`);
  }
});
