/** @jest-environment node */
// supabase/functions/_shared/__tests__/rating.test.ts
import { readFileSync } from 'node:fs';

import { mulberry32 as seeded } from '../outfitRules.ts';
import {
  buildJevRequest,
  composeRating,
  type DimensionScores,
  heightBucket,
  neutralizeUnknownWeather,
  parseJevAnswers,
  pickReasons,
  RATING_CONFIG,
  RATING_DIMENSIONS,
  RATING_LEVELS,
  type RatingDimension,
  type RatingState,
  SCORE_QUESTIONS,
} from '../rating.ts';

function fixture(name: string): unknown {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed fixture directory next to this test, not user input.
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')) as unknown;
}

const STATE: RatingState = {
  user: {
    clothing_type: 'feminine',
    body_type: 'hourglass',
    height_bucket: 'medium',
    age_group: '25_34',
    styles: ['casual', 'minimalist'],
  },
  context: {
    occasion: 'university',
    weather: { tempC: 16, condition: 'cloudy', band: 'cool', rain: false },
    season: 'autumn',
  },
  outfit: [
    { slot: 'top', category: 'sweater', colors: ['cream'], pattern: 'solid', formality: 2, fit: 'loose' },
    { slot: 'bottom', category: 'jeans', colors: ['navy'], pattern: 'solid', formality: 2, fit: 'fitted' },
    { slot: 'shoes', category: 'sneakers', colors: ['white'], pattern: 'solid', formality: 1, fit: null },
    { slot: 'accessory', category: 'scarf', colors: ['camel'], pattern: 'checked', formality: 2, fit: null },
    { slot: 'accessory', category: 'watch', colors: ['silver'], pattern: null, formality: 3, fit: null },
  ],
};

const questionsOfType = (questions: Record<string, unknown>, type: string): [string, Record<string, unknown>][] =>
  Object.entries(questions).filter(
    (entry): entry is [string, Record<string, unknown>] =>
      typeof entry[1] === 'object' && entry[1] !== null && (entry[1] as { type?: unknown }).type === type,
  );

function uniform(normalized: number, confidence = 1): DimensionScores {
  return Object.fromEntries(RATING_DIMENSIONS.map((dimension) => [dimension, { normalized, confidence }])) as DimensionScores;
}

describe('buildJevRequest', () => {
  it('asks 8 score, 2 noul and 1 choice questions of jev-latest', () => {
    const request = buildJevRequest(STATE, seeded(1));
    expect(request.model).toBe('jev-latest');
    expect(request.state).toBe(STATE);
    const scores = questionsOfType(request.questions, 'score');
    expect(scores.map(([id]) => id)).toEqual([...RATING_DIMENSIONS]);
    expect(questionsOfType(request.questions, 'noul').map(([id]) => id)).toEqual([
      'inappropriate_for_occasion',
      'unsafe_for_weather',
    ]);
    expect(questionsOfType(request.questions, 'choice').map(([id]) => id)).toEqual(['weakest_piece']);
    expect(Object.keys(request.questions)).toHaveLength(11);
  });

  it('gives every score question 3–5 string levels and English instructions', () => {
    const request = buildJevRequest(STATE, seeded(1));
    for (const [id, question] of questionsOfType(request.questions, 'score')) {
      const criteria = question.criteria as unknown[];
      expect(criteria.length).toBeGreaterThanOrEqual(3);
      expect(criteria.length).toBeLessThanOrEqual(5);
      expect(criteria.every((level) => typeof level === 'string' && level.length > 20)).toBe(true);
      expect(typeof question.instructions).toBe('string');
      expect(RATING_LEVELS[id as RatingDimension]).toBe(criteria.length);
    }
  });

  it("tells weather_fit to answer the middle level, the unknown-weather one, when weather is null", () => {
    const { instructions, criteria } = SCORE_QUESTIONS.weather_fit;
    expect(instructions).toMatch(/null/);
    expect(instructions).toMatch(/middle level/);
    expect(criteria.length % 2).toBe(1);
    expect(criteria[(criteria.length - 1) / 2]).toMatch(/weather is unknown/);
  });

  it('offers the outfit slots (deduplicated) plus none, shuffled per rand', () => {
    const optionsFor = (seed: number): string[] => {
      const choice = buildJevRequest(STATE, seeded(seed)).questions.weakest_piece as { criteria: Record<string, string> };
      return Object.keys(choice.criteria);
    };
    const first = optionsFor(1);
    const second = optionsFor(2);
    expect([...first].sort()).toEqual(['accessory', 'bottom', 'none', 'shoes', 'top']);
    expect([...second].sort()).toEqual([...first].sort());
    expect(second).not.toEqual(first);
  });

  it('carries no measurement in the state', () => {
    const serialized = JSON.stringify(buildJevRequest(STATE, seeded(1)).state);
    for (const field of ['height_cm', 'waist_cm', 'hips_cm', 'chest_cm', '_cm', 'weight', 'size']) {
      expect(serialized).not.toContain(field);
    }
    expect(Object.keys(STATE.user).sort()).toEqual(['age_group', 'body_type', 'clothing_type', 'height_bucket', 'styles']);
  });
});

describe('parseJevAnswers', () => {
  it('normalizes each score by its top level and keeps its confidence', () => {
    const parsed = parseJevAnswers(fixture('jev-ok'), RATING_LEVELS);
    expect(parsed).not.toBeNull();
    const expected: Record<RatingDimension, [number, number]> = {
      color_harmony: [0.9, 0.62],
      pattern_mix: [1, 1],
      formality_coherence: [0.8, 0.55],
      silhouette_balance: [0.6, 0.5],
      body_flattery: [0.7, 0.71],
      weather_fit: [0.8, 0.6],
      occasion_fit: [0.85, 0.58],
      style_match: [0.4, 0.45],
    };
    expect(Object.keys(parsed?.dims ?? {})).toEqual([...RATING_DIMENSIONS]);
    for (const [dimension, [normalized, confidence]] of Object.entries(expected)) {
      const actual = new Map(Object.entries(parsed?.dims ?? {})).get(dimension);
      expect(actual?.normalized).toBeCloseTo(normalized, 9);
      expect(actual?.confidence).toBe(confidence);
    }
    expect(parsed?.hardFailure).toBe(false);
    expect(parsed?.weakestSlot).toBe('shoes');
  });

  it('maps a none choice to a null weakest slot and a noul above 0.7 to a hard failure', () => {
    const parsed = parseJevAnswers(fixture('jev-hard-failure'), RATING_LEVELS);
    expect(parsed?.hardFailure).toBe(true);
    expect(parsed?.weakestSlot).toBeNull();
  });

  it('returns null for a missing, mistyped or out-of-range answer', () => {
    const ok = fixture('jev-ok') as { answers: Record<string, Record<string, unknown>> };
    const mutate = (change: (answers: Record<string, Record<string, unknown>>) => void): unknown => {
      const copy = structuredClone(ok);
      change(copy.answers);
      return copy;
    };
    expect(parseJevAnswers(null, RATING_LEVELS)).toBeNull();
    expect(parseJevAnswers({ error: 'rate_limited' }, RATING_LEVELS)).toBeNull();
    expect(parseJevAnswers(mutate((a) => delete a.style_match), RATING_LEVELS)).toBeNull();
    expect(parseJevAnswers(mutate((a) => delete a.unsafe_for_weather), RATING_LEVELS)).toBeNull();
    expect(parseJevAnswers(mutate((a) => delete a.weakest_piece), RATING_LEVELS)).toBeNull();
    expect(parseJevAnswers(mutate((a) => ((a.color_harmony as Record<string, unknown>).score = 3.5)), RATING_LEVELS)).toBeNull();
    expect(parseJevAnswers(mutate((a) => ((a.color_harmony as Record<string, unknown>).score = '2')), RATING_LEVELS)).toBeNull();
    expect(parseJevAnswers(mutate((a) => ((a.pattern_mix as Record<string, unknown>).confidence = 1.2)), RATING_LEVELS)).toBeNull();
    expect(parseJevAnswers(mutate((a) => ((a.weather_fit as Record<string, unknown>).type = 'noul')), RATING_LEVELS)).toBeNull();
    expect(parseJevAnswers(mutate((a) => ((a.unsafe_for_weather as Record<string, unknown>).noul = null)), RATING_LEVELS)).toBeNull();
    expect(parseJevAnswers(mutate((a) => ((a.weakest_piece as Record<string, unknown>).choice = 'sleeves')), RATING_LEVELS)).toBeNull();
  });
});

describe('parseJevAnswers hard failures and tolerance', () => {
  const ok = fixture('jev-ok') as { answers: Record<string, Record<string, unknown>> };
  const mutate = (change: (answers: Record<string, Record<string, unknown>>) => void): unknown => {
    const copy = structuredClone(ok);
    change(copy.answers);
    return copy;
  };

  it('reports each Noul separately, with hardFailure as their OR', () => {
    expect(parseJevAnswers(fixture('jev-ok'), RATING_LEVELS)).toMatchObject({
      hardFailure: false,
      hardFailures: { inappropriate_for_occasion: false, unsafe_for_weather: false },
    });
    expect(parseJevAnswers(fixture('jev-hard-failure'), RATING_LEVELS)).toMatchObject({
      hardFailure: true,
      hardFailures: { inappropriate_for_occasion: true, unsafe_for_weather: false },
    });
    expect(
      parseJevAnswers(mutate((a) => ((a.unsafe_for_weather as Record<string, unknown>).noul = 0.9)), RATING_LEVELS),
    ).toMatchObject({ hardFailure: true, hardFailures: { inappropriate_for_occasion: false, unsafe_for_weather: true } });
  });

  it('accepts a score, confidence or noul a rounding error outside its range and clamps it', () => {
    const parsed = parseJevAnswers(
      mutate((a) => {
        (a.color_harmony as Record<string, unknown>).score = 3 + 1e-12;
        (a.pattern_mix as Record<string, unknown>).score = -1e-12;
        (a.style_match as Record<string, unknown>).confidence = 1 + 1e-12;
        (a.formality_coherence as Record<string, unknown>).confidence = -1e-12;
        (a.unsafe_for_weather as Record<string, unknown>).noul = 1 + 1e-12;
      }),
      RATING_LEVELS,
    );
    expect(parsed?.dims.color_harmony.normalized).toBe(1);
    expect(parsed?.dims.pattern_mix.normalized).toBe(0);
    expect(parsed?.dims.style_match.confidence).toBe(1);
    expect(parsed?.dims.formality_coherence.confidence).toBe(0);
    expect(parsed?.hardFailures.unsafe_for_weather).toBe(true);
  });

  it('still rejects values clearly outside the range', () => {
    expect(parseJevAnswers(mutate((a) => ((a.color_harmony as Record<string, unknown>).score = 3 + 1e-6)), RATING_LEVELS)).toBeNull();
    expect(parseJevAnswers(mutate((a) => ((a.color_harmony as Record<string, unknown>).score = -1e-6)), RATING_LEVELS)).toBeNull();
    expect(parseJevAnswers(mutate((a) => ((a.style_match as Record<string, unknown>).confidence = 1.000001)), RATING_LEVELS)).toBeNull();
    expect(parseJevAnswers(mutate((a) => ((a.unsafe_for_weather as Record<string, unknown>).noul = -0.01)), RATING_LEVELS)).toBeNull();
  });
});

describe('neutralizeUnknownWeather', () => {
  const unsafe = (): ReturnType<typeof parseJevAnswers> => {
    const copy = structuredClone(fixture('jev-ok')) as { answers: Record<string, Record<string, unknown>> };
    (copy.answers.unsafe_for_weather as Record<string, unknown>).noul = 0.95;
    (copy.answers.weather_fit as Record<string, unknown>).score = 0;
    return parseJevAnswers(copy, RATING_LEVELS);
  };

  it('leaves the answers alone when the weather is known', () => {
    const parsed = unsafe();
    if (parsed === null) throw new Error('fixture did not parse');
    expect(neutralizeUnknownWeather(parsed, { tempC: 3, condition: 'snow', band: 'cold', rain: false })).toEqual(parsed);
  });

  it('with no weather, sets weather_fit to the neutral 0.5 (keeping its confidence) and ignores unsafe_for_weather', () => {
    const parsed = unsafe();
    if (parsed === null) throw new Error('fixture did not parse');
    expect(parsed.hardFailure).toBe(true);
    const neutral = neutralizeUnknownWeather(parsed, null);
    expect(neutral.dims.weather_fit).toEqual({ normalized: 0.5, confidence: parsed.dims.weather_fit.confidence });
    expect(neutral.hardFailure).toBe(false);
    expect(neutral.hardFailures).toEqual({ inappropriate_for_occasion: false, unsafe_for_weather: false });
    expect(neutral.weakestSlot).toBe(parsed.weakestSlot);
    // The other dimensions are untouched, and the input isn't mutated.
    expect(neutral.dims.color_harmony).toEqual(parsed.dims.color_harmony);
    expect(parsed.dims.weather_fit.normalized).toBe(0);
  });

  it('keeps inappropriate_for_occasion capping the score when the weather is unknown', () => {
    const parsed = parseJevAnswers(fixture('jev-hard-failure'), RATING_LEVELS);
    if (parsed === null) throw new Error('fixture did not parse');
    const neutral = neutralizeUnknownWeather(parsed, null);
    expect(neutral.hardFailure).toBe(true);
    expect(composeRating(neutral.dims, neutral.hardFailure).score).toBe(40);
  });
});

describe('composeRating', () => {
  it('scores all-top dimensions 100 great and all-middle 50 fair', () => {
    expect(composeRating(uniform(1), false)).toEqual({ score: 100, confidence: 100, label: 'great' });
    expect(composeRating(uniform(0.5, 0.5), false)).toEqual({ score: 50, confidence: 50, label: 'fair' });
  });

  it('weights the ok fixture into 80 good with a 63% confidence', () => {
    const parsed = parseJevAnswers(fixture('jev-ok'), RATING_LEVELS);
    if (parsed === null) throw new Error('fixture did not parse');
    expect(composeRating(parsed.dims, parsed.hardFailure)).toEqual({ score: 80, confidence: 63, label: 'good' });
  });

  it('caps a hard failure at 40 even with high dimensions', () => {
    const parsed = parseJevAnswers(fixture('jev-hard-failure'), RATING_LEVELS);
    if (parsed === null) throw new Error('fixture did not parse');
    expect(composeRating(parsed.dims, false).score).toBeGreaterThan(85);
    expect(composeRating(parsed.dims, parsed.hardFailure)).toMatchObject({ score: 40, label: 'poor' });
  });

  it('rates the low fixture poor, below the swap threshold', () => {
    const parsed = parseJevAnswers(fixture('jev-low'), RATING_LEVELS);
    if (parsed === null) throw new Error('fixture did not parse');
    const rating = composeRating(parsed.dims, parsed.hardFailure);
    expect(rating).toMatchObject({ score: 36, label: 'poor' });
    expect(rating.score).toBeLessThan(RATING_CONFIG.swapBelow);
    expect(parsed.weakestSlot).toBe('top');
  });

  it('applies the label bands at their edges', () => {
    expect(composeRating(uniform(0.85), false).label).toBe('great');
    expect(composeRating(uniform(0.84), false).label).toBe('good');
    expect(composeRating(uniform(0.7), false).label).toBe('good');
    expect(composeRating(uniform(0.69), false).label).toBe('fair');
    expect(composeRating(uniform(0.49), false).label).toBe('poor');
  });
});

describe('RATING_CONFIG', () => {
  it('has weights for every dimension that sum to 1', () => {
    expect(Object.keys(RATING_CONFIG.weights).sort()).toEqual([...RATING_DIMENSIONS].sort());
    const total = Object.values(RATING_CONFIG.weights).reduce((sum, weight) => sum + weight, 0);
    expect(Math.abs(total - 1)).toBeLessThan(1e-9);
  });

  it('keeps the thresholds from the global constraints', () => {
    expect(RATING_CONFIG).toMatchObject({
      hardFailureThreshold: 0.7,
      hardFailureCap: 40,
      swapBelow: 70,
      swapMinGain: 5,
      bands: { great: 85, good: 70, fair: 50 },
    });
  });
});

describe('pickReasons', () => {
  const colors = STATE.outfit.flatMap((piece) => piece.colors);

  it('gives at most 2 good and 1 warn reasons keyed by dimension', () => {
    const parsed = parseJevAnswers(fixture('jev-ok'), RATING_LEVELS);
    if (parsed === null) throw new Error('fixture did not parse');
    const reasons = pickReasons(parsed.dims, colors);
    expect(reasons.filter((reason) => reason.tone === 'good').length).toBeLessThanOrEqual(2);
    expect(reasons.filter((reason) => reason.tone === 'warn').length).toBeLessThanOrEqual(1);
    for (const reason of reasons) {
      const [prefix, kind, dimension, tone] = reason.key.split('.');
      expect(`${prefix ?? ''}.${kind ?? ''}`).toBe('rating.reason');
      expect(RATING_DIMENSIONS).toContain(dimension);
      expect(tone).toBe(reason.tone);
    }
    expect(reasons).toEqual([
      { key: 'rating.reason.pattern_mix.good', tone: 'good' },
      { key: 'rating.reason.color_harmony.good', tone: 'good', params: { colors: 'cream,navy,white' } },
      { key: 'rating.reason.style_match.warn', tone: 'warn' },
    ]);
  });

  it('gives no good reason below 0.6 and warns on the first weakest dimension', () => {
    const parsed = parseJevAnswers(fixture('jev-low'), RATING_LEVELS);
    if (parsed === null) throw new Error('fixture did not parse');
    expect(pickReasons(parsed.dims, colors)).toEqual([{ key: 'rating.reason.color_harmony.warn', tone: 'warn' }]);
  });

  it('gives no warn reason when nothing is below 0.5', () => {
    expect(pickReasons(uniform(0.5), colors)).toEqual([]);
  });
});

describe('heightBucket', () => {
  it('buckets by the clothing type cut points and passes null through', () => {
    expect(heightBucket(165, 'feminine')).toBe('medium');
    expect(heightBucket(185, 'masculine')).toBe('tall');
    expect(heightBucket(null, 'feminine')).toBeNull();
    expect(heightBucket(157, 'everything')).toBe('short');
    expect(heightBucket(158, 'feminine')).toBe('medium');
    expect(heightBucket(172, 'feminine')).toBe('medium');
    expect(heightBucket(173, 'feminine')).toBe('tall');
    expect(heightBucket(169, 'masculine')).toBe('short');
    expect(heightBucket(183, 'masculine')).toBe('medium');
    expect(heightBucket(175, null)).toBe('tall');
  });
});
