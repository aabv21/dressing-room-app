import type { Database } from '../lib/database.types';

export type ClothingType = Database['public']['Enums']['clothing_type'];
export type BodyType = Database['public']['Enums']['body_type'];

export type BodyAnswers = {
  shoulders: 'narrow' | 'average' | 'broad';
  hips: 'narrow' | 'average' | 'wide';
  waist: 'defined' | 'straight' | 'fuller';
};

const FEMININE_SILHOUETTES: readonly BodyType[] = ['hourglass', 'pear', 'apple', 'rectangle', 'inverted_triangle'];
const MASCULINE_SILHOUETTES: readonly BodyType[] = ['trapezoid', 'triangle', 'oval', 'rectangle', 'inverted_triangle'];

/** The silhouettes offered on the Body step; "everything" uses the feminine set (global constraints). */
export function silhouettesFor(clothing: ClothingType): readonly BodyType[] {
  return clothing === 'masculine' ? MASCULINE_SILHOUETTES : FEMININE_SILHOUETTES;
}

const WIDTH_SCORE = { narrow: 0, average: 1, broad: 2, wide: 2 } as const;

/** The "3 questions" helper: shoulders vs hips decides the shape, the waist refines it. */
export function suggestBodyType(answers: BodyAnswers, clothing: ClothingType): BodyType {
  const masculine = clothing === 'masculine';
  const diff = WIDTH_SCORE[answers.shoulders] - WIDTH_SCORE[answers.hips];

  if (answers.waist === 'fuller') {
    return masculine ? 'oval' : 'apple';
  }
  if (diff > 0) {
    if (masculine) {
      return answers.waist === 'defined' ? 'trapezoid' : 'inverted_triangle';
    }
    return 'inverted_triangle';
  }
  if (diff < 0) {
    return masculine ? 'triangle' : 'pear';
  }
  if (masculine) {
    return 'rectangle';
  }
  return answers.waist === 'defined' ? 'hourglass' : 'rectangle';
}
