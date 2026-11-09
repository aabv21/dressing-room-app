/** @jest-environment node */
// scripts/__tests__/calibration.test.ts
import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GARMENT_CATEGORIES, GARMENT_COLORS, SLOTS } from '../../supabase/functions/_shared/catalog.ts';
import {
  type DimensionScores,
  RATING_CONFIG,
  RATING_DIMENSIONS,
  type RatingAnswers,
  type RatingDimension,
  type RatingState,
  withHardFailures,
  composeRating,
} from '../../supabase/functions/_shared/rating.ts';
import {
  collectAnswers,
  collectSummary,
  exportEntries,
  fetchExportRows,
  formatReport,
  type LabelEntry,
  mergeEntries,
  parseAnswersFile,
  parseLabelsFile,
  pendingAnswers,
  runEval,
  writeLocalJson,
} from '../calibrate.ts';
import {
  type CalibrationReport,
  confusionMatrix,
  evaluate,
  type Label,
  type LabeledOutfit,
  predictedLabel,
  searchBands,
  searchWeights,
  spearman,
} from '../calibration.ts';

const ROOT = new URL('../../', import.meta.url);
const EXAMPLE_LABELS = new URL('calibration/example.labels.json', ROOT);
const EXAMPLE_ANSWERS = new URL('calibration/example.answers.json', ROOT);
// eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed repo files next to this test, not user input.
const readText = (url: URL): string => readFileSync(url, 'utf8');

const STATE: RatingState = {
  user: { clothing_type: 'feminine', body_type: null, height_bucket: null, age_group: null, styles: [] },
  context: { occasion: null, weather: null, season: 'autumn' },
  outfit: [
    { slot: 'top', category: 't_shirt', colors: ['white'], pattern: 'solid', formality: 1, fit: 'regular' },
    { slot: 'bottom', category: 'jeans', colors: ['blue'], pattern: 'solid', formality: 2, fit: 'regular' },
    { slot: 'shoes', category: 'sneakers', colors: ['white'], pattern: 'solid', formality: 1, fit: null },
  ],
};

/** Answers with every dimension at `level`, overridden per dimension, all at confidence `confidence`. */
function answersAt(
  level: number,
  overrides: Partial<Record<RatingDimension, number>> = {},
  confidence = 0.8,
  hardFailure = false,
): RatingAnswers {
  const values = new Map<string, number>(Object.entries(overrides));
  const dims = Object.fromEntries(
    RATING_DIMENSIONS.map((dimension) => [dimension, { normalized: values.get(dimension) ?? level, confidence }]),
  ) as DimensionScores;
  return withHardFailures(
    dims,
    [
      ['inappropriate_for_occasion', hardFailure],
      ['unsafe_for_weather', false],
    ],
    null,
  );
}

const outfit = (id: string, label: Label, labeler = 'alex'): LabeledOutfit => ({ id, labeler, label, state: STATE });

const LEVEL = new Map<Label, number>([
  ['bad', 0.3],
  ['ok', 0.55],
  ['good', 0.8],
]);
const levelOf = (label: Label): number => LEVEL.get(label) ?? 0;
const LABEL_CYCLE: readonly Label[] = ['bad', 'ok', 'good'];

/**
 * `count` outfits cycling bad/ok/good; `style_match` tracks the label exactly while
 * `color_harmony` (the heaviest weight) is noise, so the current weights rank them imperfectly.
 */
function skewedSet(count: number): { labeled: LabeledOutfit[]; answers: Map<string, RatingAnswers> } {
  const labeled: LabeledOutfit[] = [];
  const answers = new Map<string, RatingAnswers>();
  for (let index = 0; index < count; index += 1) {
    const label = LABEL_CYCLE[index % 3] ?? 'ok';
    const id = `o${String(index)}`;
    labeled.push(outfit(id, label, index % 2 === 0 ? 'alex' : 'sam'));
    const noise = ((index * 37) % 11) / 10;
    answers.set(id, answersAt(0.55, { style_match: levelOf(label), color_harmony: noise }, 0.5 + ((index * 3) % 5) / 10));
  }
  return { labeled, answers };
}

const onGrid = (weight: number): boolean => Math.abs(weight * 20 - Math.round(weight * 20)) < 1e-9;
const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

describe('spearman', () => {
  it('matches a hand-computed value with a tie (average ranks)', () => {
    // y ranks [1, 2, 3.5, 5, 3.5] against x ranks [1..5]: 8 / √(10 · 9.5).
    expect(spearman([1, 2, 3, 4, 5], [5, 6, 7, 8, 7])).toBeCloseTo(8 / Math.sqrt(95), 12);
  });

  it('is 1 for the same order, -1 for the reverse, and null when undefined', () => {
    expect(spearman([1, 2, 3], [10, 20, 30])).toBeCloseTo(1, 12);
    expect(spearman([1, 2, 3], [30, 20, 10])).toBeCloseTo(-1, 12);
    expect(spearman([4, 4, 4], [1, 2, 3])).toBeNull();
    expect(spearman([1], [1])).toBeNull();
  });
});

describe('predictedLabel and confusionMatrix', () => {
  it('predicts good at the good band, ok at the fair band, bad below', () => {
    const bands = RATING_CONFIG.bands;
    expect([70, 69, 50, 49].map((score) => predictedLabel(score, bands))).toEqual(['good', 'ok', 'ok', 'bad']);
  });

  it('counts label (rows) against prediction (columns)', () => {
    const labels: Label[] = ['bad', 'ok', 'good', 'good'];
    const predicted: Label[] = ['bad', 'ok', 'ok', 'good'];
    expect(confusionMatrix(labels, predicted)).toEqual({
      bad: { bad: 1, ok: 0, good: 0 },
      ok: { bad: 0, ok: 1, good: 0 },
      good: { bad: 0, ok: 1, good: 1 },
    });
  });
});

describe('searchWeights', () => {
  const { labeled, answers } = skewedSet(24);
  const samples = labeled.map((entry) => ({ label: entry.label, answers: answers.get(entry.id) ?? answersAt(0) }));

  it('stays on the 0.05 grid in [0, 1], sums to 1, and never lowers ρ', () => {
    const before = evaluate(labeled, answers, RATING_CONFIG);
    if ('error' in before) throw new Error(before.detail);
    const result = searchWeights(samples, RATING_CONFIG);
    const weights = Object.values(result.weights);
    expect(weights).toHaveLength(8);
    for (const weight of weights) {
      expect(onGrid(weight)).toBe(true);
      expect(weight).toBeGreaterThanOrEqual(0);
      expect(weight).toBeLessThanOrEqual(1);
    }
    expect(Math.abs(sum(weights) - 1)).toBeLessThan(1e-9);
    expect(result.spearman).not.toBeNull();
    expect(result.spearman ?? -1).toBeGreaterThan(before.spearman ?? -1);
    // style_match carries the signal, so it gains weight.
    expect(result.weights.style_match).toBeGreaterThan(RATING_CONFIG.weights.style_match);
  });

  it('is deterministic', () => {
    expect(searchWeights(samples, RATING_CONFIG)).toEqual(searchWeights(samples, RATING_CONFIG));
  });

  it('never moves weather_fit, even when it carries the signal', () => {
    // weather_fit tracks the label exactly; the other dimensions are noise.
    const weatherSignal = labeled.map((entry, index) => ({
      label: entry.label,
      answers: answersAt(((index * 37) % 11) / 10, { weather_fit: levelOf(entry.label) }),
    }));
    const heavierWeather = { ...RATING_CONFIG, weights: { ...RATING_CONFIG.weights, color_harmony: 0.05, weather_fit: 0.3 } };
    for (const config of [RATING_CONFIG, heavierWeather]) {
      const result = searchWeights(weatherSignal, config);
      expect(result.weights.weather_fit).toBe(config.weights.weather_fit);
      expect(Math.abs(sum(Object.values(result.weights)) - 1)).toBeLessThan(1e-9);
      for (const weight of Object.values(result.weights)) expect(onGrid(weight)).toBe(true);
    }
  });

  it('takes a move that keeps ρ but raises accuracy', () => {
    // pattern_mix sits 0.2 above every other dimension, so each 0.05 moved into it shifts every
    // score up by 1 point: the ranking (and ρ) stays, but the good outfits at 69 reach the 70 band.
    const level = new Map<Label, number>([
      ['bad', 0.2],
      ['ok', 0.5],
      ['good', 0.67],
    ]);
    const shifted = labeled.map((entry) => {
      const base = level.get(entry.label) ?? 0;
      return { label: entry.label, answers: answersAt(base, { pattern_mix: base + 0.2 }) };
    });
    const startScores = shifted.map(({ answers }) => composeRating(answers.dims, false).score);
    expect(new Set(startScores)).toEqual(new Set([22, 52, 69]));
    const result = searchWeights(shifted, RATING_CONFIG);
    expect(result.spearman).toBeCloseTo(1, 12);
    expect(result.accuracy).toBe(1);
    // The first improving move (color_harmony is tried first) gives 0.05 to pattern_mix, then nothing improves.
    expect(result.weights).toEqual({ ...RATING_CONFIG.weights, color_harmony: 0.15, pattern_mix: 0.15 });
  });

  it('keeps the current weights when no move improves ρ', () => {
    // Every dimension at the label's level: any weighting ranks them perfectly, so ρ can't improve.
    const perfect = labeled.map((entry) => ({ label: entry.label, answers: answersAt(levelOf(entry.label)) }));
    const result = searchWeights(perfect, RATING_CONFIG);
    expect(result.weights).toEqual(RATING_CONFIG.weights);
  });
});

describe('searchBands', () => {
  const sample = (label: Label, score: number) => ({ label, score });

  it('picks the thresholds closest to 70/50 among those with the best accuracy', () => {
    const perfectAnywhere = [sample('bad', 10), sample('bad', 20), sample('ok', 55), sample('ok', 60), sample('good', 90)];
    expect(searchBands(perfectAnywhere, RATING_CONFIG.bands)).toEqual({ great: 85, good: 70, fair: 50 });

    // fair must be in (53, 60] and good in (65, 80]: the closest are 54 and 70.
    const shifted = [sample('bad', 52), sample('bad', 53), sample('ok', 60), sample('ok', 65), sample('good', 80)];
    expect(searchBands(shifted, RATING_CONFIG.bands)).toEqual({ great: 85, good: 70, fair: 54 });
  });

  it('raises great above good when good reaches it, capped at 100', () => {
    const high = [sample('bad', 30), sample('ok', 88), sample('ok', 89), sample('good', 95)];
    expect(searchBands(high, RATING_CONFIG.bands)).toEqual({ great: 91, good: 90, fair: 50 });
    const top = [sample('bad', 30), sample('ok', 99), sample('good', 100)];
    expect(searchBands(top, RATING_CONFIG.bands)).toEqual({ great: 100, good: 100, fair: 50 });
    const atGreat = [sample('bad', 30), sample('ok', 84), sample('good', 85)];
    expect(searchBands(atGreat, RATING_CONFIG.bands)).toEqual({ great: 86, good: 85, fair: 50 });
  });

  it('keeps 0 < fair < good ≤ 100', () => {
    const allBad = [sample('bad', 100), sample('bad', 99)];
    const bands = searchBands(allBad, RATING_CONFIG.bands);
    expect(bands.fair).toBeGreaterThan(0);
    expect(bands.good).toBeGreaterThan(bands.fair);
    expect(bands.good).toBeLessThanOrEqual(100);
  });
});

describe('evaluate', () => {
  it('reports ρ, accuracy, the confusion matrix and a suggestion that never lowers ρ', () => {
    const { labeled, answers } = skewedSet(24);
    const report = evaluate(labeled, answers, RATING_CONFIG);
    if ('error' in report) throw new Error(report.detail);
    expect(report.n).toBe(24);
    expect(report.labelers).toEqual({ alex: 12, sam: 12 });
    expect(sum(Object.values(report.confusion).flatMap((row) => Object.values(row)))).toBe(24);
    expect(report.accuracy).toBeGreaterThanOrEqual(0);
    expect(report.accuracy).toBeLessThanOrEqual(1);
    expect(report.suggested.spearman ?? -1).toBeGreaterThanOrEqual(report.spearman ?? -1);
    expect(Math.abs(sum(Object.values(report.suggested.weights)) - 1)).toBeLessThan(1e-9);
    expect(['mean', 'min']).toContain(report.suggested.confidenceAggregate);
    expect(Object.keys(report.confidence).sort()).toEqual(['mean', 'min']);
    expect(JSON.stringify(report)).not.toContain('NaN');
  });

  it('applies unknown weather as the app does (weather_fit neutral, no weather cap)', () => {
    const { labeled, answers } = skewedSet(12);
    const capped = new Map([...answers].map(([id, a]) => [id, { ...a, hardFailure: true, hardFailures: { ...a.hardFailures, unsafe_for_weather: true } }]));
    const plain = evaluate(labeled, answers, RATING_CONFIG);
    const weatherOnly = evaluate(labeled, capped, RATING_CONFIG);
    if ('error' in plain || 'error' in weatherOnly) throw new Error('unexpected error');
    expect(weatherOnly.spearman).toEqual(plain.spearman);
    expect(weatherOnly.accuracy).toEqual(plain.accuracy);
  });

  it('reports ρ as null, never NaN, when every score is the same', () => {
    const { labeled } = skewedSet(12);
    const flat = new Map(labeled.map((entry) => [entry.id, answersAt(0.6)]));
    const report = evaluate(labeled, flat, RATING_CONFIG);
    if ('error' in report) throw new Error(report.detail);
    expect(report.spearman).toBeNull();
    expect(JSON.stringify(report)).not.toContain('NaN');
  });

  describe('the confidence aggregate', () => {
    /**
     * 12 outfits scored in their band (every dimension at the label's level, confidence 0.6) and 2
     * `bad` outfits scored 80 like the good ones, so they land in `good` whatever the weights and
     * bands. The wrong ones carry `wrongConfidences`.
     */
    function confidenceSet(wrongConfidences: Partial<Record<RatingDimension, number>>, wrongBase: number) {
      const labeled: LabeledOutfit[] = [];
      const answers = new Map<string, RatingAnswers>();
      for (let index = 0; index < 12; index += 1) {
        const label = LABEL_CYCLE[index % 3] ?? 'ok';
        labeled.push(outfit(`right${String(index)}`, label));
        answers.set(`right${String(index)}`, answersAt(levelOf(label), {}, 0.6));
      }
      for (let index = 0; index < 2; index += 1) {
        labeled.push(outfit(`wrong${String(index)}`, 'bad'));
        const answer = answersAt(0.8, {}, wrongBase);
        const confidences = new Map<string, number>(Object.entries(wrongConfidences));
        const dims = Object.fromEntries(
          RATING_DIMENSIONS.map((dimension) => [
            dimension,
            { normalized: 0.8, confidence: confidences.get(dimension) ?? wrongBase },
          ]),
        ) as DimensionScores;
        answers.set(`wrong${String(index)}`, { ...answer, dims });
      }
      return { labeled, answers };
    }

    it('suggests min when its ρ with band correctness is higher', () => {
      // Wrong outfits: confident overall (mean 86) but one dimension at 0.1 (min 10); right ones: 60 both ways.
      const { labeled, answers } = confidenceSet({ style_match: 0.1 }, 0.9);
      const report = evaluate(labeled, answers, RATING_CONFIG);
      if ('error' in report) throw new Error(report.detail);
      expect(report.suggested.accuracy).toBeCloseTo(12 / 14, 12);
      expect(report.confidence.min ?? -2).toBeGreaterThan(report.confidence.mean ?? 2);
      expect(report.suggested.confidenceAggregate).toBe('min');
    });

    it('keeps the current aggregate on a tie', () => {
      // Every dimension at the same confidence: mean = min for every outfit, so the ρs are equal.
      const { labeled, answers } = confidenceSet({}, 0.9);
      for (const aggregate of ['mean', 'min'] as const) {
        const report = evaluate(labeled, answers, { ...RATING_CONFIG, confidenceAggregate: aggregate });
        if ('error' in report) throw new Error(report.detail);
        expect(report.confidence.mean).not.toBeNull();
        expect(report.confidence.min).toBeCloseTo(report.confidence.mean ?? Number.NaN, 12);
        expect(report.suggested.confidenceAggregate).toBe(aggregate);
      }
    });

    it('keeps the current aggregate when both ρs are undefined (every band right)', () => {
      const labeled = Array.from({ length: 12 }, (_, index) => outfit(`p${String(index)}`, LABEL_CYCLE[index % 3] ?? 'ok'));
      const answers = new Map(labeled.map((entry) => [entry.id, answersAt(levelOf(entry.label))]));
      const report = evaluate(labeled, answers, { ...RATING_CONFIG, confidenceAggregate: 'min' });
      if ('error' in report) throw new Error(report.detail);
      expect(report.confidence).toEqual({ mean: null, min: null });
      expect(report.suggested.confidenceAggregate).toBe('min');
    });
  });

  describe('tiny, skewed or broken data', () => {
    it('refuses all-good labels', () => {
      const labeled = Array.from({ length: 12 }, (_, index) => outfit(`g${String(index)}`, 'good'));
      const answers = new Map(labeled.map((entry) => [entry.id, answersAt(0.8)]));
      const result = evaluate(labeled, answers, RATING_CONFIG);
      expect(result).toMatchObject({ error: 'not_enough_data' });
      expect(JSON.stringify(result)).not.toContain('NaN');
    });

    it('refuses 3 outfits', () => {
      const { labeled, answers } = skewedSet(3);
      const result = evaluate(labeled, answers, RATING_CONFIG);
      expect(result).toMatchObject({ error: 'not_enough_data' });
      expect(JSON.stringify(result)).not.toContain('NaN');
    });

    it('refuses a labeled outfit with no answer, naming it', () => {
      const { labeled, answers } = skewedSet(12);
      answers.delete('o7');
      const result = evaluate(labeled, answers, RATING_CONFIG);
      expect(result).toMatchObject({ error: 'missing_answers' });
      expect('error' in result ? result.detail : '').toContain('o7');
    });
  });
});

describe('labels and answers files', () => {
  const entry = (id: string, label: Label | null): LabelEntry => ({
    id,
    labeler: 'alex',
    label,
    description: 'a fictional outfit',
    state: STATE,
  });

  it('parses the example fixtures', () => {
    const labels = parseLabelsFile(readText(EXAMPLE_LABELS));
    const answers = parseAnswersFile(readText(EXAMPLE_ANSWERS));
    if ('error' in labels || 'error' in answers) throw new Error('fixture did not parse');
    expect(labels.entries).toHaveLength(12);
    expect(answers.answers.size).toBe(12);
  });

  it('commits only fictional, catalog-valid example states', () => {
    const labels = parseLabelsFile(readText(EXAMPLE_LABELS));
    if ('error' in labels) throw new Error(labels.detail);
    for (const { state } of labels.entries) {
      expect(state.context.weather).toBeNull();
      for (const piece of state.outfit) {
        expect(SLOTS).toContain(piece.slot);
        expect(GARMENT_CATEGORIES).toContain(piece.category);
        for (const color of piece.colors) expect(GARMENT_COLORS).toContain(color);
      }
    }
  });

  it.each([
    ['invalid JSON', '[{'],
    ['not an array', '{"id": "a"}'],
    ['an unknown label', JSON.stringify([{ ...entry('a', 'good'), label: 'great' }])],
    ['a missing state', JSON.stringify([{ id: 'a', labeler: 'alex', label: 'ok', description: '' }])],
    ['an outfit that is not an array', JSON.stringify([{ ...entry('a', 'ok'), state: { ...STATE, outfit: 'x' } }])],
    ['a duplicate id', JSON.stringify([entry('a', 'ok'), entry('a', 'bad')])],
    ['an empty id', JSON.stringify([entry('', 'ok')])],
  ])('rejects a labels file with %s as malformed_labels', (_, text) => {
    expect(parseLabelsFile(text)).toMatchObject({ error: 'malformed_labels' });
  });

  it('keeps unlabeled entries (label null) without treating them as malformed', () => {
    const parsed = parseLabelsFile(JSON.stringify([entry('a', null), entry('b', 'ok')]));
    if ('error' in parsed) throw new Error(parsed.detail);
    expect(parsed.entries.map((item) => item.label)).toEqual([null, 'ok']);
  });

  it.each([
    ['invalid JSON', '{'],
    ['an array', '[]'],
    ['an answer that does not parse', JSON.stringify({ a: { answers: { color_harmony: { type: 'score', score: 9 } } } })],
  ])('rejects an answers file with %s as malformed_answers', (_, text) => {
    expect(parseAnswersFile(text)).toMatchObject({ error: 'malformed_answers' });
  });
});

describe('runEval', () => {
  const labelsText = readText(EXAMPLE_LABELS);
  const answersText = readText(EXAMPLE_ANSWERS);

  it('prints a Markdown report of the example fixtures with the suggested weights', () => {
    const { code, stdout } = runEval(labelsText, answersText);
    expect(code).toBe(0);
    expect(stdout).toContain('Spearman');
    expect(stdout).toContain('Accuracy');
    expect(stdout).toContain('Suggested');
    for (const dimension of RATING_DIMENSIONS) expect(stdout).toContain(dimension);
    expect(stdout).toMatch(/weights: \{/);
    expect(stdout).toMatch(/confidenceAggregate: '(mean|min)'/);
    expect(stdout).toContain('`weather_fit` is held at its current weight');
    expect(stdout).not.toContain('NaN');
  });

  it('flags a suggested great band that moves', () => {
    const parsedLabels = parseLabelsFile(labelsText);
    const parsedAnswers = parseAnswersFile(answersText);
    if ('error' in parsedLabels || 'error' in parsedAnswers) throw new Error('fixture did not parse');
    const report = evaluate(
      parsedLabels.entries.flatMap(({ id, labeler, label, state }) => (label === null ? [] : [{ id, labeler, label, state }])),
      parsedAnswers.answers,
      RATING_CONFIG,
    );
    if ('error' in report) throw new Error(report.detail);
    const moved: CalibrationReport = { ...report, suggested: { ...report.suggested, bands: { great: 91, good: 90, fair: 50 } } };
    expect(formatReport(moved, RATING_CONFIG)).toContain('`great` moves from 85 to 91');
    const kept: CalibrationReport = { ...report, suggested: { ...report.suggested, bands: { great: 85, good: 72, fair: 50 } } };
    expect(formatReport(kept, RATING_CONFIG)).not.toContain('`great` moves');
  });

  const labels = JSON.parse(labelsText) as unknown[];
  const allGood = JSON.stringify(labels.map((item) => ({ ...(item as object), label: 'good' })));
  const three = JSON.stringify(labels.slice(0, 3));
  const answersMissingOne = JSON.stringify(
    Object.fromEntries(Object.entries(JSON.parse(answersText) as object).filter(([id]) => id !== 'example-05')),
  );

  it.each([
    ['all-good labels', allGood, answersText, 2, /not enough data/i],
    ['3 outfits', three, answersText, 2, /not enough data/i],
    ['a missing answer', labelsText, answersMissingOne, 2, /example-05/],
    ['a malformed labels file', '[{', answersText, 1, /malformed/i],
    ['a malformed answers file', labelsText, '[]', 1, /malformed/i],
  ])('exits %#: %s → code %i, a clear message, no report and no NaN', (_, labelText, answerText, code, message) => {
    const result = runEval(labelText, answerText);
    expect(result.code).toBe(code);
    expect(result.stderr).toMatch(message);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toContain('NaN');
  });
});

describe('export helpers', () => {
  const GARMENT = (id: string, category: string, colors: string[]) => ({
    id,
    category,
    colors,
    pattern: 'solid',
    formality: 2,
    seasons: [],
    warmth: 2,
    fit: 'regular',
    status: 'available',
    last_worn_at: null,
    updated_at: '2026-10-01T00:00:00Z',
    pinned_on: null,
  });
  const garments = [
    GARMENT('00000000-0000-4000-8000-000000000001', 'blouse', ['black', 'white']),
    GARMENT('00000000-0000-4000-8000-000000000002', 'jeans', ['blue']),
    GARMENT('00000000-0000-4000-8000-000000000003', 'sneakers', ['white']),
    GARMENT('00000000-0000-4000-8000-000000000004', 'scarf', ['red']),
  ];
  const profile = {
    clothing_type: 'feminine',
    body_type: 'pear',
    height_cm: 165,
    age_group: '25_34',
    styles: ['casual'],
    city_name: 'Somewhere',
    city_lat: -34.6,
    city_lon: -58.4,
    updated_at: '2026-10-01T00:00:00Z',
  };
  const items = (...ids: number[]) => ids.map((n) => ({ garment_id: `00000000-0000-4000-8000-00000000000${String(n)}` }));

  it('builds each saved outfit into an unlabeled entry with the rate-outfit state and no weather', () => {
    const entries = exportEntries(
      {
        profile,
        garments,
        outfits: [
          { id: 'outfit-1', saved_at: '2026-11-08T12:00:00+00:00', outfit_items: items(3, 1, 2) },
          // No shoes: not a complete outfit, so it can't be rated and is skipped.
          { id: 'outfit-2', saved_at: '2026-11-08T12:00:00+00:00', outfit_items: items(1, 4) },
        ],
      },
      'alex',
    );
    expect(entries).toHaveLength(1);
    const [first] = entries;
    expect(first).toMatchObject({ id: 'outfit-1', labeler: 'alex', label: null });
    expect(first?.state).toEqual({
      user: { clothing_type: 'feminine', body_type: 'pear', height_bucket: 'medium', age_group: '25_34', styles: ['casual'] },
      // Southern hemisphere in November.
      context: { occasion: null, weather: null, season: 'spring' },
      outfit: [
        { slot: 'top', category: 'blouse', colors: ['black', 'white'], pattern: 'solid', formality: 2, fit: 'regular' },
        { slot: 'bottom', category: 'jeans', colors: ['blue'], pattern: 'solid', formality: 2, fit: 'regular' },
        { slot: 'shoes', category: 'sneakers', colors: ['white'], pattern: 'solid', formality: 2, fit: 'regular' },
      ],
    });
    expect(first?.description).toBe('Saved 2026-11-08: top: blouse (black, white); bottom: jeans (blue); shoes: sneakers (white)');
    // No ids, measurements or city in what Jev will see.
    expect(JSON.stringify(first?.state)).not.toMatch(/0000|165|Somewhere/);
  });

  it('appends only outfits that are not in the labels file yet, keeping existing labels', () => {
    const existing: LabelEntry[] = [{ ...entryOf('a'), label: 'good' }];
    const merged = mergeEntries(existing, [entryOf('a'), entryOf('b')]);
    expect(merged.map((item) => [item.id, item.label])).toEqual([
      ['a', 'good'],
      ['b', null],
    ]);
  });

  it('reads the profile, garments and saved outfits with the service role', async () => {
    const calls: { url: string; headers: unknown }[] = [];
    const fakeFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
      calls.push({ url, headers: init?.headers });
      const body = url.includes('/profiles') ? [profile] : url.includes('/garments') ? garments : [];
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    };
    const user = '00000000-0000-4000-8000-0000000000aa';
    const rows = await fetchExportRows({ supabaseUrl: 'https://example.supabase.co', serviceRoleKey: 'srv' }, fakeFetch, user);
    expect(rows.profile).toEqual(profile);
    expect(rows.garments).toHaveLength(4);
    expect(calls.map((call) => call.url)).toEqual([
      expect.stringMatching(new RegExp(`^https://example\\.supabase\\.co/rest/v1/profiles\\?select=.*&user_id=eq\\.${user}$`)),
      expect.stringMatching(new RegExp(`/rest/v1/garments\\?select=.*&user_id=eq\\.${user}&order=id$`)),
      expect.stringMatching(
        new RegExp(`/rest/v1/outfits\\?select=id,saved_at,outfit_items\\(garment_id\\)&user_id=eq\\.${user}&saved_at=not\\.is\\.null&order=saved_at$`),
      ),
    ]);
    for (const call of calls) expect(call.headers).toEqual({ apikey: 'srv', authorization: 'Bearer srv' });
    await expect(fetchExportRows({ supabaseUrl: 'https://x', serviceRoleKey: 'srv' }, fakeFetch, 'not-a-uuid')).rejects.toThrow(/uuid/);
  });
});

function entryOf(id: string): LabelEntry {
  return { id, labeler: 'alex', label: null, description: 'a fictional outfit', state: STATE };
}

describe('collect helpers', () => {
  const entries: LabelEntry[] = [
    { ...entryOf('a'), label: 'good' },
    { ...entryOf('b'), label: null },
    { ...entryOf('c'), label: 'bad' },
    { ...entryOf('d'), label: 'ok' },
  ];
  const example = JSON.parse(readText(EXAMPLE_ANSWERS)) as Record<string, unknown>;
  const body = example['example-01'];

  it('asks only for labeled outfits with no saved answer', () => {
    expect(pendingAnswers(entries, new Set(['a'])).map((item) => item.id)).toEqual(['c', 'd']);
  });

  it('calls Jev once per pending outfit, saves parseable answers and lists failures', async () => {
    const asked: RatingState[] = [];
    const jev = (state: RatingState): Promise<unknown> => {
      asked.push(state);
      return Promise.resolve(asked.length === 1 ? body : { answers: {} });
    };
    const result = await collectAnswers(entries, { a: body }, jev);
    expect(asked).toHaveLength(2);
    expect(Object.keys(result.bodies).sort()).toEqual(['a', 'c']);
    expect(result.added).toEqual(['c']);
    expect(result.failed).toEqual(['d']);
  });
});

describe('collectSummary', () => {
  it('is quiet and 0 when every pending outfit got an answer', () => {
    expect(collectSummary({ added: ['a'], failed: [] }, 'answers.local.json')).toMatchObject({ code: 0, stderr: '' });
  });

  it('lists failures and exits 1 when some failed, without the key hint', () => {
    const summary = collectSummary({ added: ['a'], failed: ['b'] }, 'answers.local.json');
    expect(summary.code).toBe(1);
    expect(summary.stderr).toContain('b');
    expect(summary.stderr).not.toContain('TYPESAFE_API_KEY');
  });

  it('hints at the key and base URL when every call failed', () => {
    const summary = collectSummary({ added: [], failed: ['a', 'b'] }, 'answers.local.json');
    expect(summary.code).toBe(1);
    expect(summary.stderr).toContain('TYPESAFE_API_KEY');
    expect(summary.stderr).toContain('TYPESAFE_BASE_URL');
  });
});

describe('writeLocalJson', () => {
  it('leaves the file readable by the owner only, also when it already existed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'calibration-'));
    try {
      const path = join(dir, 'labels.local.json');
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- a temp directory this test created.
      await writeFile(path, '[]');
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- same temp file.
      await chmod(path, 0o644);
      await writeLocalJson(path, [{ id: 'a' }]);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- same temp file.
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- same temp file.
      expect(JSON.parse(readFileSync(path, 'utf8')) as unknown).toEqual([{ id: 'a' }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('the CLI', () => {
  const cli = (args: string[]): { status: number; stdout: string; stderr: string } => {
    try {
      const stdout = execFileSync(process.execPath, ['scripts/calibrate.ts', ...args], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        // Blank keys: the CLI must refuse to reach Supabase or TypeSafe, whatever the shell has set.
        env: { ...process.env, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', TYPESAFE_API_KEY: '' },
      });
      return { status: 0, stdout, stderr: '' };
    } catch (error) {
      const failed = error as { status: number; stdout: string; stderr: string };
      return { status: failed.status, stdout: failed.stdout, stderr: failed.stderr };
    }
  };

  it('evaluates the example fixtures and exits 0', () => {
    const result = cli(['eval', '--labels', 'calibration/example.labels.json', '--answers', 'calibration/example.answers.json']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Spearman');
  });

  it('exits 2 on too few labeled outfits', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'calibration-'));
    try {
      const labelsPath = join(dir, 'labels.json');
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- a temp directory this test created.
      await writeFile(labelsPath, JSON.stringify((JSON.parse(readText(EXAMPLE_LABELS)) as unknown[]).slice(0, 3)));
      const result = cli(['eval', '--labels', labelsPath, '--answers', 'calibration/example.answers.json']);
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/not enough data/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('exits 1 on an unknown command, and refuses export and collect without their environment', () => {
    expect(cli(['nope']).status).toBe(1);
    const exported = cli(['export', '--user', '00000000-0000-4000-8000-0000000000aa', '--labeler', 'alex']);
    expect(exported.status).toBe(1);
    expect(exported.stderr).toMatch(/SUPABASE_URL/);
    const collected = cli(['collect']);
    expect(collected.status).toBe(1);
    expect(collected.stderr).toMatch(/TYPESAFE_API_KEY/);
  });

  it('keeps personal calibration files out of git', () => {
    expect(readText(new URL('.gitignore', ROOT)).split('\n')).toContain('calibration/*.local.json');
  });
});
