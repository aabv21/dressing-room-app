/** @jest-environment node */
// scripts/__tests__/calibration.test.ts
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
} from '../../supabase/functions/_shared/rating.ts';
import {
  collectAnswers,
  exportEntries,
  fetchExportRows,
  type LabelEntry,
  mergeEntries,
  parseAnswersFile,
  parseLabelsFile,
  pendingAnswers,
  runEval,
} from '../calibrate.ts';
import {
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

  it('raises great to good when good moves above it', () => {
    const high = [sample('bad', 30), sample('ok', 88), sample('ok', 89), sample('good', 95)];
    expect(searchBands(high, RATING_CONFIG.bands)).toEqual({ great: 90, good: 90, fair: 50 });
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
    expect(stdout).not.toContain('NaN');
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
