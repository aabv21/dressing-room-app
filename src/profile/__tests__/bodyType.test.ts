import { silhouettesFor, suggestBodyType } from '../bodyType';
import type { BodyAnswers } from '../bodyType';

// The full 27-case table for feminine (and therefore "everything"), written out row by row so a
// regression in the algorithm shows the exact combination that changed.
const FEMININE_TABLE: readonly (readonly [BodyAnswers['shoulders'], BodyAnswers['hips'], BodyAnswers['waist'], string])[] = [
  ['narrow', 'narrow', 'defined', 'hourglass'],
  ['narrow', 'narrow', 'straight', 'rectangle'],
  ['narrow', 'narrow', 'fuller', 'apple'],
  ['narrow', 'average', 'defined', 'pear'],
  ['narrow', 'average', 'straight', 'pear'],
  ['narrow', 'average', 'fuller', 'apple'],
  ['narrow', 'wide', 'defined', 'pear'],
  ['narrow', 'wide', 'straight', 'pear'],
  ['narrow', 'wide', 'fuller', 'apple'],
  ['average', 'narrow', 'defined', 'inverted_triangle'],
  ['average', 'narrow', 'straight', 'inverted_triangle'],
  ['average', 'narrow', 'fuller', 'apple'],
  ['average', 'average', 'defined', 'hourglass'],
  ['average', 'average', 'straight', 'rectangle'],
  ['average', 'average', 'fuller', 'apple'],
  ['average', 'wide', 'defined', 'pear'],
  ['average', 'wide', 'straight', 'pear'],
  ['average', 'wide', 'fuller', 'apple'],
  ['broad', 'narrow', 'defined', 'inverted_triangle'],
  ['broad', 'narrow', 'straight', 'inverted_triangle'],
  ['broad', 'narrow', 'fuller', 'apple'],
  ['broad', 'average', 'defined', 'inverted_triangle'],
  ['broad', 'average', 'straight', 'inverted_triangle'],
  ['broad', 'average', 'fuller', 'apple'],
  ['broad', 'wide', 'defined', 'hourglass'],
  ['broad', 'wide', 'straight', 'rectangle'],
  ['broad', 'wide', 'fuller', 'apple'],
];

test('the feminine table has all 27 combinations', () => {
  const keys = new Set(FEMININE_TABLE.map(([shoulders, hips, waist]) => `${shoulders}/${hips}/${waist}`));
  expect(keys.size).toBe(27);
});

test.each(FEMININE_TABLE)('feminine %s shoulders, %s hips, %s waist → %s', (shoulders, hips, waist, expected) => {
  expect(suggestBodyType({ shoulders, hips, waist }, 'feminine')).toBe(expected);
});

test.each(FEMININE_TABLE)('everything follows the feminine table: %s/%s/%s → %s', (shoulders, hips, waist, expected) => {
  expect(suggestBodyType({ shoulders, hips, waist }, 'everything')).toBe(expected);
});

test('masculine spot checks', () => {
  expect(suggestBodyType({ shoulders: 'broad', hips: 'narrow', waist: 'defined' }, 'masculine')).toBe('trapezoid');
  expect(suggestBodyType({ shoulders: 'narrow', hips: 'wide', waist: 'straight' }, 'masculine')).toBe('triangle');
  expect(suggestBodyType({ shoulders: 'average', hips: 'average', waist: 'fuller' }, 'masculine')).toBe('oval');
  expect(suggestBodyType({ shoulders: 'broad', hips: 'narrow', waist: 'straight' }, 'masculine')).toBe('inverted_triangle');
  expect(suggestBodyType({ shoulders: 'average', hips: 'average', waist: 'defined' }, 'masculine')).toBe('rectangle');
});

test('every suggestion is one of the silhouettes offered for that clothing type', () => {
  const levels = ['narrow', 'average', 'broad'] as const;
  const hipLevels = ['narrow', 'average', 'wide'] as const;
  const waists = ['defined', 'straight', 'fuller'] as const;
  for (const clothing of ['feminine', 'masculine', 'everything'] as const) {
    for (const shoulders of levels) {
      for (const hips of hipLevels) {
        for (const waist of waists) {
          expect(silhouettesFor(clothing)).toContain(suggestBodyType({ shoulders, hips, waist }, clothing));
        }
      }
    }
  }
});

test('silhouette sets per clothing type', () => {
  expect(silhouettesFor('feminine')).toEqual(['hourglass', 'pear', 'apple', 'rectangle', 'inverted_triangle']);
  expect(silhouettesFor('masculine')).toEqual(['trapezoid', 'triangle', 'oval', 'rectangle', 'inverted_triangle']);
  expect(silhouettesFor('everything')).toEqual(silhouettesFor('feminine'));
});
