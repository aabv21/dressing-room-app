// Outfit rating with TypeSafe's Jev (System One): the request (8 Score dimensions, 2 hard-failure
// Nouls and a shuffled "weakest piece" Choice), the answer parser, the composite score and the
// template reasons the app renders.
//
// Runtime-neutral (only the other `_shared` modules imported, nothing Deno- or
// Node-only) so Jest exercises it under Node and the Edge Functions run it under Deno. The state
// carries buckets and enum values only — never exact measurements. See `docs/ai.md`'s
// "Outfit rating" for the levels verbatim, the weights and the bands.

import {
  type ClothingType,
  type GarmentCategory,
  type GarmentColor,
  type GarmentFit,
  type GarmentPattern,
  type Occasion,
  type Season,
  type Slot,
  SLOTS,
} from './catalog.ts';
import { isRecord } from './extraction.ts';
import { seededShuffle } from './outfitRules.ts';
import type { WeatherSummary } from './weather.ts';

export const JEV_MODEL = 'jev-latest';

export const RATING_DIMENSIONS = [
  'color_harmony',
  'pattern_mix',
  'formality_coherence',
  'silhouette_balance',
  'body_flattery',
  'weather_fit',
  'occasion_fit',
  'style_match',
] as const;

export type RatingDimension = (typeof RATING_DIMENSIONS)[number];

export const HARD_FAILURES = ['inappropriate_for_occasion', 'unsafe_for_weather'] as const;

export type HardFailure = (typeof HARD_FAILURES)[number];

export const WEAKEST_PIECE = 'weakest_piece';
export const NO_WEAK_PIECE = 'none';

export const RATING_CONFIG = {
  weights: {
    color_harmony: 0.2,
    pattern_mix: 0.1,
    formality_coherence: 0.15,
    silhouette_balance: 0.1,
    body_flattery: 0.1,
    weather_fit: 0.15,
    occasion_fit: 0.15,
    style_match: 0.05,
  } satisfies Record<RatingDimension, number>,
  hardFailureThreshold: 0.7,
  hardFailureCap: 40,
  swapBelow: 70,
  swapMinGain: 5,
  bands: { great: 85, good: 70, fair: 50 },
} as const;

export type RatingLabel = 'great' | 'good' | 'fair' | 'poor';

/** `public.body_type`, `public.age_group` and `public.style` (SQL-only enums today, like `GarmentStatus`). */
export type BodyType =
  | 'hourglass'
  | 'pear'
  | 'apple'
  | 'rectangle'
  | 'inverted_triangle'
  | 'trapezoid'
  | 'triangle'
  | 'oval';
export type AgeGroup = 'under_18' | '18_24' | '25_34' | '35_44' | '45_54' | '55_plus';
export type Style = 'casual' | 'elegant' | 'minimalist' | 'sporty' | 'urban' | 'bohemian' | 'classic';

export type HeightBucket = 'short' | 'medium' | 'tall';

export type RatingPiece = {
  slot: Slot;
  category: GarmentCategory;
  colors: GarmentColor[];
  pattern: GarmentPattern | null;
  formality: number | null;
  fit: GarmentFit | null;
};

/** Everything Jev (or the fallback) sees. Buckets and enum values only; no ids, names or measurements. */
export type RatingState = {
  user: {
    clothing_type: ClothingType | null;
    body_type: BodyType | null;
    height_bucket: HeightBucket | null;
    age_group: AgeGroup | null;
    styles: Style[];
  };
  context: { occasion: Occasion | null; weather: WeatherSummary | null; season: Season };
  outfit: RatingPiece[];
};

export type DimensionScores = Record<RatingDimension, { normalized: number; confidence: number }>;

export type RatingAnswers = {
  dims: DimensionScores;
  /** The OR of `hardFailures`, which is what `composeRating` takes. */
  hardFailure: boolean;
  hardFailures: Record<HardFailure, boolean>;
  weakestSlot: Slot | null;
};

export type RatingReason = { key: string; tone: 'good' | 'warn'; params?: Record<string, string> };

/** The cut points of the height bucket; `everything` and an unknown clothing type use the feminine ones. */
export function heightBucket(cm: number | null, clothingType: ClothingType | null): HeightBucket | null {
  if (cm === null) return null;
  const [shortBelow, mediumUpTo] = clothingType === 'masculine' ? [170, 183] : [158, 172];
  if (cm < shortBelow) return 'short';
  if (cm <= mediumUpTo) return 'medium';
  return 'tall';
}

type ScoreQuestion = { type: 'score'; instructions: string; criteria: readonly string[] };

/** The Score questions: English instructions and situational levels, worst (index 0) first. */
export const SCORE_QUESTIONS: Record<RatingDimension, ScoreQuestion> = {
  color_harmony: {
    type: 'score',
    instructions: 'How well do the colors of the pieces in `outfit` work together?',
    criteria: [
      'At least two colors clash outright, such as competing bright colors or tones that fight each other',
      'Nothing clashes outright, but the colors look unrelated, as if each piece was picked on its own',
      'The colors sit together safely, such as all neutrals or one color repeated, without a clear idea behind them',
      'The colors were clearly chosen together: a tonal palette, complementary colors, or neutrals with one accent that ties the pieces together',
    ],
  },
  pattern_mix: {
    type: 'score',
    instructions: 'How well do the patterns of the pieces in `outfit` combine?',
    criteria: [
      'Several busy patterns compete, such as florals with checks and stripes',
      'Two patterns are combined without a shared color or a difference in scale, so they fight for attention',
      'All pieces are solid, one patterned piece is balanced by plain pieces, or the patterns share a color and differ in scale',
    ],
  },
  formality_coherence: {
    type: 'score',
    instructions:
      'Do the pieces in `outfit` belong to the same level of formality? `formality` runs from 1 (very casual) to 5 (formal).',
    criteria: [
      'Pieces from opposite ends of formality are mixed, such as a tailored blazer with gym shorts or heels with sweatpants',
      'One piece is clearly more formal or more casual than the rest and looks out of place',
      'The pieces are close in formality, with a small gap that reads as relaxed rather than wrong',
      'Every piece sits at the same level of formality',
    ],
  },
  silhouette_balance: {
    type: 'score',
    instructions: 'How balanced are the proportions of the outfit, given each piece\'s category and `fit`?',
    criteria: [
      'The proportions fight each other, such as oversized pieces on top and bottom that swallow the body',
      'The proportions are off in one place, such as a top whose length or volume overwhelms the bottom',
      'The proportions are acceptable but nothing gives the outfit a shape',
      'Volume and fit are balanced, such as a loose piece paired with a fitted one, giving the outfit a clear shape',
    ],
  },
  body_flattery: {
    type: 'score',
    instructions:
      'How well do the cuts in `outfit` suit the user\'s `body_type` and `height_bucket`? When both are null, the body is unknown.',
    criteria: [
      'The cuts work against the user\'s body type and height, such as hiding the waist of an hourglass figure or cutting the legs of a short user',
      'One piece works against the user\'s body type or height while the rest are neutral',
      'The cuts neither help nor hurt the user\'s body type and height, or the body is unknown',
      'The cuts favor the user\'s body type and height, such as defining the waist or lengthening the legs where that helps',
    ],
  },
  weather_fit: {
    type: 'score',
    instructions:
      'How well does the outfit suit today\'s weather in `context.weather`? When `context.weather` is null the weather is unknown: answer with the middle level, the one that says the weather is unknown.',
    criteria: [
      'The outfit is dangerous for the weather, such as sandals and shorts in snow or a heavy coat in a heat wave',
      'The outfit is uncomfortable for the weather: clearly too warm, too cold, or without protection on a rainy day',
      'The weather is unknown, or the outfit suits it only in part',
      'The outfit suits the weather, with a small mismatch such as a layer that is slightly too light',
      'The outfit is exactly right for the temperature and the rain or sun, with suitable shoes and layers',
    ],
  },
  occasion_fit: {
    type: 'score',
    instructions:
      'How well does the outfit suit the occasion in `context.occasion`? When it is null, judge it for an ordinary day out.',
    criteria: [
      'The outfit is wrong for the occasion, such as gym wear at the office or an evening gown at home',
      'The outfit is out of step with the occasion, too formal or too casual in a way other people would notice',
      'The outfit is acceptable for the occasion, though one piece is a little off',
      'The outfit is exactly what the occasion calls for',
    ],
  },
  style_match: {
    type: 'score',
    instructions: 'How well does the outfit express the styles the user likes, listed in `user.styles`?',
    criteria: [
      'The outfit contradicts every style the user likes, such as a tracksuit for someone who only likes elegant looks',
      'The outfit has little to do with the styles the user likes',
      'The outfit partly reflects one of the user\'s styles, or the user listed no styles',
      'The outfit clearly expresses one or more of the styles the user likes',
    ],
  },
};

/** Level counts per dimension (the `nᵢ` of the composite score); pass this to the parsers. */
export const RATING_LEVELS = Object.fromEntries(
  Object.entries(SCORE_QUESTIONS).map(([dimension, question]) => [dimension, question.criteria.length]),
) as Record<RatingDimension, number>;

export const NOUL_QUESTIONS: Record<
  HardFailure,
  { type: 'noul'; instructions: string; criteria: { true: string; false: string } }
> = {
  inappropriate_for_occasion: {
    type: 'noul',
    instructions:
      'Would wearing this outfit to the occasion in `context.occasion` be inappropriate or embarrassing? When the occasion is null, answer no unless the outfit could not be worn in public.',
    criteria: {
      true: 'The outfit breaks what the occasion expects badly enough to embarrass the wearer, such as beachwear at the office or a tracksuit at a formal event',
      false: 'The outfit is acceptable for the occasion, even if it is not ideal',
    },
  },
  unsafe_for_weather: {
    type: 'noul',
    instructions:
      'Is this outfit unsafe or seriously uncomfortable for the weather in `context.weather`? When the weather is null, answer no.',
    criteria: {
      true: 'The outfit leaves the wearer exposed to cold, heat or rain in a way that could harm them or ruin their day, such as open shoes and no coat in freezing weather',
      false: 'The outfit is safe for the weather, even if it is not ideal',
    },
  },
};

export const WEAKEST_PIECE_INSTRUCTIONS =
  'Which single piece of `outfit`, named by its slot, weakens the outfit the most? Choose none when every piece works.';

/** What each Choice option means; a slot's option is the piece in `outfit` with that `slot`. */
export const WEAKEST_PIECE_OPTIONS: Record<Slot | typeof NO_WEAK_PIECE, string> = {
  top: 'The piece with slot "top": the shirt, sweater or other upper-body garment',
  bottom: 'The piece with slot "bottom": the pants, jeans, skirt or shorts',
  one_piece: 'The piece with slot "one_piece": the dress or jumpsuit',
  outerwear: 'The piece with slot "outerwear": the jacket, coat, blazer or vest',
  shoes: 'The piece with slot "shoes"',
  bag: 'The piece with slot "bag"',
  headwear: 'The piece with slot "headwear": the hat',
  accessory: 'A piece with slot "accessory": the belt, scarf, tie, jewelry, sunglasses or watch',
  none: 'No single piece weakens the outfit; changing any one of them would not improve it',
};

/** The outfit's distinct slots plus `none`, in outfit order (callers shuffle). */
export function weakestPieceOptions(outfit: readonly RatingPiece[]): (Slot | typeof NO_WEAK_PIECE)[] {
  return [...new Set(outfit.map((piece) => piece.slot)), NO_WEAK_PIECE];
}

/**
 * The System One request body for one outfit. The weakest-piece options are shuffled with `rand`
 * on every request, since a Choice has a position bias; the option order is the key order of
 * `criteria`.
 */
export function buildJevRequest(
  state: RatingState,
  rand: () => number,
): { model: typeof JEV_MODEL; state: RatingState; questions: Record<string, unknown> } {
  const offered = new Set<string>(weakestPieceOptions(state.outfit));
  const options = seededShuffle(
    Object.entries(WEAKEST_PIECE_OPTIONS).filter(([option]) => offered.has(option)),
    rand,
  );
  return {
    model: JEV_MODEL,
    state,
    questions: {
      ...SCORE_QUESTIONS,
      ...NOUL_QUESTIONS,
      [WEAKEST_PIECE]: {
        type: 'choice',
        instructions: WEAKEST_PIECE_INSTRUCTIONS,
        criteria: Object.fromEntries(options),
      },
    },
  };
}

// Jev's probability-weighted values can land a rounding error outside their range (1.0000000002).
const RANGE_TOLERANCE = 1e-9;

/** `value` clamped to [min, max] when it is a finite number within the tolerance of that range; otherwise null. */
function inRange(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < min - RANGE_TOLERANCE || value > max + RANGE_TOLERANCE) return null;
  return Math.min(max, Math.max(min, value));
}

/** `none` → null; a slot → that slot; anything else → undefined (malformed). */
export function slotFromAnswer(value: unknown): Slot | null | undefined {
  if (value === NO_WEAK_PIECE) return null;
  return SLOTS.find((slot) => slot === value);
}

/**
 * Maps a System One response body to normalized dimension scores (score ÷ (levels − 1), 0..1),
 * the hard-failure flags (each Noul above the threshold, and their OR) and the weakest slot.
 * Never throws; null when any answer is missing, of the wrong type or out of range by more than
 * a 1e-9 rounding tolerance (values within it are clamped).
 */
export function parseJevAnswers(body: unknown, levels: Record<RatingDimension, number>): RatingAnswers | null {
  if (!isRecord(body) || !isRecord(body.answers)) return null;
  const answers = new Map(Object.entries(body.answers));
  const levelCounts = new Map<string, number>(Object.entries(levels));

  const dims: [RatingDimension, { normalized: number; confidence: number }][] = [];
  for (const dimension of RATING_DIMENSIONS) {
    const answer = answers.get(dimension);
    const top = (levelCounts.get(dimension) ?? 0) - 1;
    if (!isRecord(answer) || answer.type !== 'score' || top < 1) return null;
    const score = inRange(answer.score, 0, top);
    const confidence = inRange(answer.confidence, 0, 1);
    if (score === null || confidence === null) return null;
    dims.push([dimension, { normalized: score / top, confidence }]);
  }

  const failures: [HardFailure, boolean][] = [];
  for (const failure of HARD_FAILURES) {
    const answer = answers.get(failure);
    const noul = isRecord(answer) && answer.type === 'noul' ? inRange(answer.noul, 0, 1) : null;
    if (noul === null) return null;
    failures.push([failure, noul > RATING_CONFIG.hardFailureThreshold]);
  }

  const choice = answers.get(WEAKEST_PIECE);
  if (!isRecord(choice) || choice.type !== 'choice') return null;
  const weakestSlot = slotFromAnswer(choice.choice);
  if (weakestSlot === undefined) return null;

  return withHardFailures(Object.fromEntries(dims) as DimensionScores, failures, weakestSlot);
}

/** Assembles `RatingAnswers` from per-Noul flags, deriving `hardFailure` as their OR. */
export function withHardFailures(
  dims: DimensionScores,
  failures: readonly (readonly [HardFailure, boolean])[],
  weakestSlot: Slot | null,
): RatingAnswers {
  const hardFailures = Object.fromEntries(failures) as Record<HardFailure, boolean>;
  return { dims, hardFailure: failures.some(([, failed]) => failed), hardFailures, weakestSlot };
}

const NEUTRAL_WEATHER_FIT = 0.5;

/**
 * With no weather (no city, or one that can't be geocoded), the rating is neutral on weather
 * whatever the rater answered: `weather_fit` becomes the middle level (0.5, keeping the rater's
 * confidence in it) and `unsafe_for_weather` no longer caps the score. Known weather passes
 * through unchanged. Never mutates `answers`.
 */
export function neutralizeUnknownWeather(answers: RatingAnswers, weather: WeatherSummary | null): RatingAnswers {
  if (weather !== null) return answers;
  const dims: DimensionScores = {
    ...answers.dims,
    weather_fit: { normalized: NEUTRAL_WEATHER_FIT, confidence: answers.dims.weather_fit.confidence },
  };
  return withHardFailures(
    dims,
    [
      ['inappropriate_for_occasion', answers.hardFailures.inappropriate_for_occasion],
      ['unsafe_for_weather', false],
    ],
    answers.weakestSlot,
  );
}

export function labelOf(score: number): RatingLabel {
  const { bands } = RATING_CONFIG;
  if (score >= bands.great) return 'great';
  if (score >= bands.good) return 'good';
  if (score >= bands.fair) return 'fair';
  return 'poor';
}

/**
 * `score = round(100 · Σ wᵢ · normalizedᵢ)`, capped when a hard failure fired; the confidence is the
 * weighted mean of the per-dimension confidences, on 0..100.
 */
export function composeRating(
  dims: DimensionScores,
  hardFailure: boolean,
): { score: number; confidence: number; label: RatingLabel } {
  const weights = new Map<string, number>(Object.entries(RATING_CONFIG.weights));
  let weightedScore = 0;
  let weightedConfidence = 0;
  for (const [dimension, { normalized, confidence }] of Object.entries(dims)) {
    const weight = weights.get(dimension) ?? 0;
    weightedScore += weight * normalized;
    weightedConfidence += weight * confidence;
  }
  const raw = Math.round(100 * weightedScore);
  const score = hardFailure ? Math.min(raw, RATING_CONFIG.hardFailureCap) : raw;
  return { score, confidence: Math.round(100 * weightedConfidence), label: labelOf(score) };
}

const GOOD_AT_LEAST = 0.6;
const WARN_BELOW = 0.5;
const MAX_GOOD_REASONS = 2;
const MAX_REASON_COLORS = 3;

/**
 * The template reasons: the two strongest dimensions at or above 0.6 (`good`) and the weakest below
 * 0.5 (`warn`). Ties keep `RATING_DIMENSIONS` order. color_harmony's good reason gets
 * `params.colors`: the outfit's first 3 distinct color enum values, comma-separated, in outfit
 * order; the app localizes each through `garment.color.*` before interpolating.
 */
export function pickReasons(dims: DimensionScores, outfitColors: readonly GarmentColor[]): RatingReason[] {
  const order = (dimension: RatingDimension): number => RATING_DIMENSIONS.indexOf(dimension);
  const byStrength = (Object.entries(dims) as [RatingDimension, { normalized: number }][]).sort(
    ([a, x], [b, y]) => y.normalized - x.normalized || order(a) - order(b),
  );
  const reasons: RatingReason[] = byStrength
    .filter(([, { normalized }]) => normalized >= GOOD_AT_LEAST)
    .slice(0, MAX_GOOD_REASONS)
    .map(([dimension]) => {
      const reason: RatingReason = { key: `rating.reason.${dimension}.good`, tone: 'good' };
      if (dimension === 'color_harmony') {
        reason.params = { colors: [...new Set(outfitColors)].slice(0, MAX_REASON_COLORS).join(',') };
      }
      return reason;
    });

  // The weakest is the last after the stable sort; among equal minimums, take the first dimension.
  const minimum = byStrength.at(-1)?.[1].normalized;
  const weakest = byStrength.find(([, { normalized }]) => normalized === minimum);
  if (weakest !== undefined && weakest[1].normalized < WARN_BELOW) {
    reasons.push({ key: `rating.reason.${weakest[0]}.warn`, tone: 'warn' });
  }
  return reasons;
}
