// The Jev calibration math: how well the composite score agrees with hand labels (Spearman's ρ and
// band accuracy), and the weights, bands and confidence aggregate that agree best. Pure: no files,
// no network. `scripts/calibrate.ts` is the CLI around it; `docs/ai.md`'s "Calibration" explains
// the workflow.

import {
  type ConfidenceAggregate,
  composeRating,
  neutralizeUnknownWeather,
  RATING_CONFIG,
  RATING_DIMENSIONS,
  type RatingAnswers,
  type RatingBands,
  type RatingConfig,
  type RatingDimension,
  type RatingState,
} from '../supabase/functions/_shared/rating.ts';

export type Label = 'bad' | 'ok' | 'good';

/** Worst first; the order of the confusion matrix's rows and columns. */
export const LABELS = ['bad', 'ok', 'good'] as const satisfies readonly Label[];

export type LabeledOutfit = { id: string; labeler: string; label: Label; state: RatingState };

/** Rows are the hand label, columns the band the score falls in. */
export type Confusion = Record<Label, Record<Label, number>>;

export type Weights = Record<RatingDimension, number>;

export type CalibrationReport = {
  n: number;
  /** Labeled outfits per labeler. */
  labelers: Record<string, number>;
  /** With the current config. Null when undefined (every score equal). */
  spearman: number | null;
  accuracy: number;
  confusion: Confusion;
  /** Per aggregate: Spearman's ρ between the confidence and band correctness (1/0) under the suggestion. */
  confidence: Record<ConfidenceAggregate, number | null>;
  suggested: {
    weights: Weights;
    bands: RatingBands;
    confidenceAggregate: ConfidenceAggregate;
    spearman: number | null;
    accuracy: number;
    confusion: Confusion;
  };
};

export type CalibrationError = { error: 'not_enough_data' | 'missing_answers'; detail: string };

export const MIN_LABELED = 10;

/**
 * Dimensions the weight search never moves. Calibration outfits carry no weather, so `weather_fit`
 * is always the neutral 0.5 and its weight can't be learned from them.
 * NOTE: weather's weight stays untuned; ceiling: it keeps the hand-set value; upgrade path: label
 * outfits rated with known weather and unfreeze it. The `min` confidence aggregate still includes
 * `weather_fit`'s confidence, as production computes it.
 */
export const FROZEN_DIMENSIONS: readonly RatingDimension[] = ['weather_fit'];

/** Weights move in steps of 1/20 = 0.05; they are searched as integer units that sum to 20. */
const UNITS = 20;
const EPSILON = 1e-12;

function labelValue(label: Label): number {
  switch (label) {
    case 'bad':
      return 0;
    case 'ok':
      return 1;
    case 'good':
      return 2;
  }
}

/** Average ranks (1-based): a value tied `count` times from sorted position `first` gets first + (count + 1) / 2. */
function ranks(values: readonly number[]): number[] {
  const first = new Map<number, number>();
  const count = new Map<number, number>();
  [...values]
    .sort((a, b) => a - b)
    .forEach((value, position) => {
      if (!first.has(value)) first.set(value, position);
      count.set(value, (count.get(value) ?? 0) + 1);
    });
  return values.map((value) => (first.get(value) ?? 0) + ((count.get(value) ?? 1) + 1) / 2);
}

/**
 * Spearman's ρ: the Pearson correlation of the average ranks. Null when it is undefined: fewer than
 * 2 pairs, or either side constant.
 */
export function spearman(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mean = (rx.length + 1) / 2;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  rx.forEach((x, index) => {
    const dx = x - mean;
    const dy = (ry.at(index) ?? mean) - mean;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  });
  if (varianceX < EPSILON || varianceY < EPSILON) return null;
  return covariance / Math.sqrt(varianceX * varianceY);
}

/** The band a score falls in: `good` from `bands.good`, `ok` from `bands.fair`, else `bad`. */
export function predictedLabel(score: number, bands: Pick<RatingBands, 'good' | 'fair'>): Label {
  if (score >= bands.good) return 'good';
  if (score >= bands.fair) return 'ok';
  return 'bad';
}

export function confusionMatrix(labels: readonly Label[], predicted: readonly Label[]): Confusion {
  const count = (actual: Label, guess: Label): number =>
    labels.filter((label, index) => label === actual && predicted.at(index) === guess).length;
  const row = (actual: Label): Record<Label, number> => ({
    bad: count(actual, 'bad'),
    ok: count(actual, 'ok'),
    good: count(actual, 'good'),
  });
  return { bad: row('bad'), ok: row('ok'), good: row('good') };
}

/** One labeled outfit's answers, already neutral on unknown weather the way the app composes them. */
export type Sample = { label: Label; answers: RatingAnswers };

type Fit = { spearman: number | null; correct: number };

const scoresOf = (samples: readonly Sample[], config: RatingConfig): number[] =>
  samples.map(({ answers }) => composeRating(answers.dims, answers.hardFailure, config).score);

function correctCount(samples: readonly { label: Label }[], scores: readonly number[], bands: RatingBands): number {
  return samples.filter(({ label }, index) => predictedLabel(scores.at(index) ?? 0, bands) === label).length;
}

function fitOf(samples: readonly Sample[], config: RatingConfig): Fit {
  const scores = scoresOf(samples, config);
  return {
    spearman: spearman(scores, samples.map(({ label }) => labelValue(label))),
    correct: correctCount(samples, scores, config.bands),
  };
}

/** A higher ρ wins (an undefined ρ loses to any number); equal ρ goes to more correct bands. */
function better(candidate: Fit, incumbent: Fit): boolean {
  const a = candidate.spearman ?? Number.NEGATIVE_INFINITY;
  const b = incumbent.spearman ?? Number.NEGATIVE_INFINITY;
  if (a > b + EPSILON) return true;
  if (a < b - EPSILON) return false;
  return candidate.correct > incumbent.correct;
}

/** Weights snapped to the 0.05 grid (largest remainder, so the units still sum to 20). */
function toUnits(weights: Readonly<Weights>): Map<RatingDimension, number> {
  const given = new Map<string, number>(Object.entries(weights));
  const exact = new Map(RATING_DIMENSIONS.map((dimension) => [dimension, Math.max(0, given.get(dimension) ?? 0) * UNITS]));
  const units = new Map(RATING_DIMENSIONS.map((dimension) => [dimension, Math.floor(exact.get(dimension) ?? 0)]));
  const remainder = (dimension: RatingDimension): number => (exact.get(dimension) ?? 0) - (units.get(dimension) ?? 0);
  const byRemainder = [...RATING_DIMENSIONS].sort((a, b) => remainder(b) - remainder(a));
  let missing = UNITS - [...units.values()].reduce((total, unit) => total + unit, 0);
  for (let index = 0; missing !== 0; index = (index + 1) % byRemainder.length) {
    const dimension = byRemainder.at(index);
    if (dimension === undefined) break;
    const current = units.get(dimension) ?? 0;
    if (missing > 0) {
      units.set(dimension, current + 1);
      missing -= 1;
    } else if (current > 0) {
      units.set(dimension, current - 1);
      missing += 1;
    }
  }
  return units;
}

const toWeights = (units: ReadonlyMap<RatingDimension, number>): Weights =>
  Object.fromEntries(RATING_DIMENSIONS.map((dimension) => [dimension, (units.get(dimension) ?? 0) / UNITS])) as Weights;

/**
 * Coordinate descent over the weights on the 0.05 grid, starting from `config.weights`, with the
 * `FROZEN_DIMENSIONS` held at their weight (moves happen among the other 7, so the sum stays 1).
 * For each dimension in `RATING_DIMENSIONS` order, it takes the best single move of 0.05 to or from
 * that dimension (another dimension on the other side), if it raises ρ, or keeps ρ and raises band
 * accuracy under `config.bands`. Sweeps repeat until one changes nothing. Every move strictly
 * improves (ρ, accuracy), so it terminates, and it is deterministic.
 */
export function searchWeights(
  samples: readonly Sample[],
  config: RatingConfig,
): { weights: Weights; spearman: number | null; accuracy: number } {
  const units = toUnits(config.weights);
  const fitWith = (candidate: ReadonlyMap<RatingDimension, number>): Fit =>
    fitOf(samples, { ...config, weights: toWeights(candidate) });
  let best = fitWith(units);
  const movable = RATING_DIMENSIONS.filter((dimension) => !FROZEN_DIMENSIONS.includes(dimension));
  let improved = true;
  while (improved) {
    improved = false;
    for (const dimension of movable) {
      let move: { units: Map<RatingDimension, number>; fit: Fit } | null = null;
      for (const other of movable) {
        if (other === dimension) continue;
        for (const [from, to] of [
          [other, dimension],
          [dimension, other],
        ] as const) {
          const fromUnits = units.get(from) ?? 0;
          if (fromUnits === 0) continue;
          const candidate = new Map(units);
          candidate.set(from, fromUnits - 1);
          candidate.set(to, (units.get(to) ?? 0) + 1);
          const fit = fitWith(candidate);
          if (better(fit, move?.fit ?? best)) move = { units: candidate, fit };
        }
      }
      if (move !== null) {
        for (const [key, value] of move.units) units.set(key, value);
        best = move.fit;
        improved = true;
      }
    }
  }
  return { weights: toWeights(units), spearman: best.spearman, accuracy: samples.length === 0 ? 0 : best.correct / samples.length };
}

/**
 * The integer `good` and `fair` thresholds (0 < fair < good ≤ 100) with the best band accuracy for
 * these scores. Ties go to the smallest |good − current good| + |fair − current fair|, then to the
 * lower `good`, then the lower `fair`. `great` isn't labeled, so it stays, unless `good` reaches it:
 * then it becomes `good + 1` (at most 100), so the `good` band never vanishes.
 */
export function searchBands(samples: readonly { label: Label; score: number }[], current: RatingBands): RatingBands {
  const scores = samples.map(({ score }) => score);
  let best = { good: current.good, fair: current.fair, correct: -1, distance: Number.POSITIVE_INFINITY };
  for (let good = 2; good <= 100; good += 1) {
    for (let fair = 1; fair < good; fair += 1) {
      const correct = correctCount(samples, scores, { great: current.great, good, fair });
      const distance = Math.abs(good - current.good) + Math.abs(fair - current.fair);
      if (correct > best.correct || (correct === best.correct && distance < best.distance)) {
        best = { good, fair, correct, distance };
      }
    }
  }
  return { great: Math.min(100, Math.max(current.great, best.good + 1)), good: best.good, fair: best.fair };
}

/**
 * Spearman's ρ between each outfit's confidence (under `aggregate`) and whether its score fell in
 * the labeled band (1/0). A useful confidence is high where the score is right.
 */
function confidenceSpearman(samples: readonly Sample[], config: RatingConfig, aggregate: ConfidenceAggregate): number | null {
  const withAggregate = { ...config, confidenceAggregate: aggregate };
  const confidences: number[] = [];
  const correct: number[] = [];
  for (const { label, answers } of samples) {
    const { score, confidence } = composeRating(answers.dims, answers.hardFailure, withAggregate);
    confidences.push(confidence);
    correct.push(predictedLabel(score, config.bands) === label ? 1 : 0);
  }
  return spearman(confidences, correct);
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Agreement between `config`'s composite score and the hand labels, and the suggested weights,
 * bands and confidence aggregate. Refuses fewer than `MIN_LABELED` outfits or a single distinct
 * label (`not_enough_data`), and a labeled outfit with no answer (`missing_answers`).
 */
export function evaluate(
  labeled: readonly LabeledOutfit[],
  answers: ReadonlyMap<string, RatingAnswers>,
  config: RatingConfig = RATING_CONFIG,
): CalibrationReport | CalibrationError {
  const distinct = new Set(labeled.map(({ label }) => label));
  if (labeled.length < MIN_LABELED || distinct.size < 2) {
    return {
      error: 'not_enough_data',
      detail: `${String(labeled.length)} labeled outfit(s) with ${String(distinct.size)} distinct label(s); at least ${String(MIN_LABELED)} outfits and 2 distinct labels are needed.`,
    };
  }
  const missing = labeled.filter(({ id }) => !answers.has(id)).map(({ id }) => id);
  if (missing.length > 0) {
    return {
      error: 'missing_answers',
      detail: `${String(missing.length)} labeled outfit(s) have no Jev answer: ${missing.join(', ')}.`,
    };
  }

  const samples: Sample[] = labeled.flatMap(({ id, label, state }) => {
    const answer = answers.get(id);
    return answer === undefined ? [] : [{ label, answers: neutralizeUnknownWeather(answer, state.context.weather) }];
  });
  const labels = samples.map(({ label }) => label);
  const n = samples.length;

  const currentScores = scoresOf(samples, config);
  const current = fitOf(samples, config);

  const weightSearch = searchWeights(samples, config);
  const withWeights: RatingConfig = { ...config, weights: weightSearch.weights };
  const suggestedScores = scoresOf(samples, withWeights);
  const bands = searchBands(
    samples.map(({ label }, index) => ({ label, score: suggestedScores.at(index) ?? 0 })),
    config.bands,
  );
  const suggestedConfig: RatingConfig = { ...withWeights, bands };

  const confidence = {
    mean: confidenceSpearman(samples, suggestedConfig, 'mean'),
    min: confidenceSpearman(samples, suggestedConfig, 'min'),
  };
  // The higher ρ wins (an undefined ρ loses); a tie keeps the current aggregate.
  const meanRho = confidence.mean ?? Number.NEGATIVE_INFINITY;
  const minRho = confidence.min ?? Number.NEGATIVE_INFINITY;
  const confidenceAggregate: ConfidenceAggregate =
    meanRho > minRho + EPSILON ? 'mean' : minRho > meanRho + EPSILON ? 'min' : config.confidenceAggregate;

  return {
    n,
    labelers: countBy(labeled.map(({ labeler }) => labeler)),
    spearman: current.spearman,
    accuracy: current.correct / n,
    confusion: confusionMatrix(
      labels,
      currentScores.map((score) => predictedLabel(score, config.bands)),
    ),
    confidence,
    suggested: {
      weights: weightSearch.weights,
      bands,
      confidenceAggregate,
      spearman: weightSearch.spearman,
      accuracy: correctCount(samples, suggestedScores, bands) / n,
      confusion: confusionMatrix(
        labels,
        suggestedScores.map((score) => predictedLabel(score, bands)),
      ),
    },
  };
}
