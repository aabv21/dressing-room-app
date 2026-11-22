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
  expect(translate('en', 'grid.empty')).toBe('Take photos of a top, a bottom and shoes to start.');
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
  expect(keys).toContain('rating.reason.color_harmony.good.one');
  expect(keys).toContain('rating.reason.color_harmony.good.plain');
  for (const label of ['great', 'good', 'fair', 'poor'] satisfies RatingLabel[]) {
    expect(keys).toContain(`rating.label.${label}`);
  }
});

test('garment statuses read as neutral Spanish, the same for any garment', () => {
  expect(es['garment.status.available']).toBe('Disponible');
  expect(es['garment.status.laundry']).toBe('En la lavandería');
  expect(es['garment.status.lent']).toBe('En préstamo');
  expect(es['garment.status.donated']).toBe('Donación');
});

test('the Spanish table is neutral Latin American Spanish, without regionalisms', () => {
  const text = Object.values(es).join(' ').toLowerCase();
  for (const word of ['franela', 'baleta', 'chancleta', 'guayo']) expect(text).not.toContain(word);
});

// Button labels in the user's own voice ("I'll wear it") are the user speaking, not the app.
const USER_VOICE: ReadonlySet<string> = new Set([
  'outfit.wear',
  'auth.haveAccount',
  'onboarding.style.useLocation',
  'profile.privacy.export',
  'today.notForMe',
  'trip.plan',
  'buyCheck.entry',
  'buyCheck.title',
  'buyCheck.add',
]);

test('the app speaks in the second person, never as I or we', () => {
  const appVoice = (table: Record<string, string>) =>
    Object.entries(table).filter(([key]) => !USER_VOICE.has(key));
  const enFirstPerson = /\b(I|I'm|I'll|I've|me|my|we|we're|we'll|we've|us|our)\b/i;
  expect(appVoice(en).filter(([, text]) => enFirstPerson.test(text))).toEqual([]);
  const esFirstPerson = /\b(pude|pudimos|podemos|puedo|enviaremos|enviamos|sugerimos|mostramos|muestro|nuestro|nuestra)\b/i;
  expect(appVoice(es).filter(([, text]) => esFirstPerson.test(text))).toEqual([]);
});

test('the body-type warning suggests, kindly, instead of judging', () => {
  expect(en['rating.reason.body_flattery.warn']).toBe('Another cut may suit you better (from your profile)');
  expect(es['rating.reason.body_flattery.warn']).toBe('Otro corte podría quedarte mejor (según tu perfil)');
});

test('the queued note and the button name a logged wear with the same word', () => {
  expect(en['outfit.queued'].startsWith('Logged')).toBe(true);
  expect(en['outfit.logged'].startsWith('Logged')).toBe(true);
  expect(es['outfit.queued'].startsWith('Anotado')).toBe(true);
  expect(es['outfit.logged'].startsWith('Anotado')).toBe(true);
});
