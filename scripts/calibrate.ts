// `node scripts/calibrate.ts <export | collect | eval>`: the Jev calibration workflow (see
// `docs/ai.md`'s "Calibration"). `export` turns a user's saved outfits into unlabeled entries in
// `calibration/labels.local.json`, `collect` asks Jev once for every labeled outfit without an
// answer and saves the answers to `calibration/answers.local.json`, and `eval` prints the agreement
// report with suggested weights. Both `.local.json` files hold personal data and are gitignored;
// `eval` only prints, it never writes a config.

import { chmod, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { isCompleteOutfit, seasonOf } from '../supabase/functions/_shared/outfitRules.ts';
import { type GarmentCategory, SLOTS, slotOf } from '../supabase/functions/_shared/catalog.ts';
import { isRecord } from '../supabase/functions/_shared/extraction.ts';
import {
  buildJevRequest,
  parseJevAnswers,
  RATING_CONFIG,
  RATING_DIMENSIONS,
  RATING_LEVELS,
  type RatingAnswers,
  type RatingConfig,
  type RatingState,
} from '../supabase/functions/_shared/rating.ts';
import {
  GARMENT_COLUMNS,
  garmentFrom,
  mapLimit,
  MAX_CONCURRENT_JEV,
  PROFILE_COLUMNS,
  profileFrom,
  ratingState,
  restRows,
  runJev,
  serviceHeaders,
  UUID,
} from '../supabase/functions/_shared/userContext.ts';
import {
  type CalibrationReport,
  type Confusion,
  evaluate,
  FROZEN_DIMENSIONS,
  type Label,
  type LabeledOutfit,
  LABELS,
} from './calibration.ts';

const CALIBRATION_DIR = fileURLToPath(new URL('../calibration/', import.meta.url));
const LABELS_PATH = resolve(CALIBRATION_DIR, 'labels.local.json');
const ANSWERS_PATH = resolve(CALIBRATION_DIR, 'answers.local.json');
const DEFAULT_TYPESAFE_BASE_URL = 'https://api.typesafe.ai';

/** One outfit in a labels file; `label` is null until someone labels it. */
export type LabelEntry = { id: string; labeler: string; label: Label | null; description: string; state: RatingState };

type Malformed<E extends string> = { error: E; detail: string };

const isLabel = (value: unknown): value is Label => LABELS.some((label) => label === value);

/**
 * A labels file: a JSON array of entries with a unique non-empty `id`, a `labeler`, a `label` (one
 * of bad/ok/good, or null) and a `state`.
 */
export function parseLabelsFile(text: string): { entries: LabelEntry[] } | Malformed<'malformed_labels'> {
  const fail = (detail: string): Malformed<'malformed_labels'> => ({ error: 'malformed_labels', detail });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail('the labels file is not valid JSON');
  }
  if (!Array.isArray(parsed)) return fail('the labels file must be a JSON array of outfits');
  const entries: LabelEntry[] = [];
  const seen = new Set<string>();
  for (const [index, item] of (parsed as unknown[]).entries()) {
    const at = `entry ${String(index + 1)}`;
    if (!isRecord(item) || typeof item.id !== 'string' || item.id === '') return fail(`${at} has no id`);
    if (seen.has(item.id)) return fail(`${at} repeats the id ${item.id}`);
    seen.add(item.id);
    if (typeof item.labeler !== 'string' || item.labeler === '') return fail(`${item.id} has no labeler`);
    if (item.label !== null && !isLabel(item.label)) return fail(`${item.id}'s label must be bad, ok, good or null`);
    if (!isStateShaped(item.state)) return fail(`${item.id} has no valid state`);
    entries.push({
      id: item.id,
      labeler: item.labeler,
      label: item.label,
      description: typeof item.description === 'string' ? item.description : '',
      // NOTE: only the shape is checked, not every enum (the export writes them from validated
      // rows); upgrade path: validate the enums too if labels files start being written by hand.
      state: item.state as RatingState,
    });
  }
  return { entries };
}

function isStateShaped(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.user) || !isRecord(value.context)) return false;
  const { weather, season } = value.context;
  if (typeof season !== 'string' || (weather !== null && !isRecord(weather))) return false;
  return Array.isArray(value.outfit) && (value.outfit as unknown[]).every((piece) => isRecord(piece) && typeof piece.slot === 'string');
}

/** The entries someone has labeled. */
export function labeledOutfits(entries: readonly LabelEntry[]): LabeledOutfit[] {
  return entries.flatMap(({ id, labeler, label, state }) => (label === null ? [] : [{ id, labeler, label, state }]));
}

/** An answers file: a JSON object from outfit id to the Jev response body `collect` saved. */
export function parseAnswersFile(
  text: string,
): { answers: Map<string, RatingAnswers>; bodies: Record<string, unknown> } | Malformed<'malformed_answers'> {
  const fail = (detail: string): Malformed<'malformed_answers'> => ({ error: 'malformed_answers', detail });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail('the answers file is not valid JSON');
  }
  if (!isRecord(parsed) || Array.isArray(parsed)) return fail('the answers file must be a JSON object keyed by outfit id');
  const answers = new Map<string, RatingAnswers>();
  for (const [id, body] of Object.entries(parsed)) {
    const answer = parseJevAnswers(body, RATING_LEVELS);
    if (answer === null) return fail(`the answer for ${id} is not a complete Jev answer`);
    answers.set(id, answer);
  }
  return { answers, bodies: parsed };
}

// --- eval --------------------------------------------------------------------------------------

const formatRho = (rho: number | null): string => (rho === null ? 'n/a' : rho.toFixed(3));
const formatAccuracy = (accuracy: number, n: number): string =>
  `${String(Math.round(accuracy * 100))}% (${String(Math.round(accuracy * n))} of ${String(n)})`;

function confusionTable(confusion: Confusion): string[] {
  return [
    '| label \\ predicted | bad | ok | good |',
    '| --- | --- | --- | --- |',
    ...(
      [
        ['bad', confusion.bad],
        ['ok', confusion.ok],
        ['good', confusion.good],
      ] as const
    ).map(([label, row]) => `| ${label} | ${String(row.bad)} | ${String(row.ok)} | ${String(row.good)} |`),
  ];
}

/** The Markdown report `eval` prints. */
/** Why `frozen` keep their weights, with the verb and the movable count derived; null if none is frozen. */
export function frozenWeightsNote(frozen: readonly string[], total: number): string | null {
  if (frozen.length === 0) return null;
  const names = frozen.map((dimension) => `\`${dimension}\``);
  const list = names.length === 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
  const one = frozen.length === 1;
  return `${list} ${one ? 'is held at its current weight' : 'are held at their current weights'}: the calibration outfits carry no weather, so ${one ? 'its answer is' : 'their answers are'} always neutral and ${one ? 'its weight' : 'their weights'} can't be learned from them. The other ${String(total - frozen.length)} weights share the rest.`;
}

export function formatReport(report: CalibrationReport, config: RatingConfig): string {
  const { suggested } = report;
  const frozenNote = frozenWeightsNote(FROZEN_DIMENSIONS, RATING_DIMENSIONS.length);
  const labelers = Object.entries(report.labelers)
    .map(([labeler, count]) => `${labeler} ${String(count)}`)
    .join(', ');
  const currentWeights = new Map<string, number>(Object.entries(config.weights));
  const suggestedWeights = new Map<string, number>(Object.entries(suggested.weights));
  const weight = (weights: Map<string, number>, dimension: string): string => (weights.get(dimension) ?? 0).toFixed(2);
  const aggregateRow = (aggregate: 'mean' | 'min', rho: number | null): string =>
    `| ${aggregate}${aggregate === config.confidenceAggregate ? ' (current)' : ''} | ${formatRho(rho)} |`;
  return [
    '# Jev calibration',
    '',
    `${String(report.n)} labeled outfits (${labelers}). Labels: bad = 0, ok = 1, good = 2.`,
    '',
    '| | Current | Suggested |',
    '| --- | --- | --- |',
    `| Spearman's ρ (score vs label) | ${formatRho(report.spearman)} | ${formatRho(suggested.spearman)} |`,
    `| Accuracy (band vs label) | ${formatAccuracy(report.accuracy, report.n)} | ${formatAccuracy(suggested.accuracy, report.n)} |`,
    '',
    '## Weights',
    '',
    '| Dimension | Current | Suggested |',
    '| --- | --- | --- |',
    ...RATING_DIMENSIONS.map(
      (dimension) =>
        `| \`${dimension}\` | ${weight(currentWeights, dimension)} | ${weight(suggestedWeights, dimension)} |`,
    ),
    '',
    ...(frozenNote === null ? [] : [frozenNote, '']),
    '## Bands',
    '',
    '| Band | Current | Suggested |',
    '| --- | --- | --- |',
    `| good | ≥ ${String(config.bands.good)} | ≥ ${String(suggested.bands.good)} |`,
    `| fair (ok) | ≥ ${String(config.bands.fair)} | ≥ ${String(suggested.bands.fair)} |`,
    `| great (not labeled) | ≥ ${String(config.bands.great)} | ≥ ${String(suggested.bands.great)} |`,
    '',
    ...(suggested.bands.great === config.bands.great
      ? []
      : [
          `\`great\` moves from ${String(config.bands.great)} to ${String(suggested.bands.great)}: it isn't labeled, but it must stay above the suggested \`good\` band. Check that "great" still reads right before applying it.`,
          '',
        ]),
    '## Confusion matrices',
    '',
    'Rows are the hand label, columns the band the score falls in.',
    '',
    '### Current',
    '',
    ...confusionTable(report.confusion),
    '',
    '### Suggested',
    '',
    ...confusionTable(suggested.confusion),
    '',
    '## Confidence aggregate',
    '',
    "Spearman's ρ between the confidence and band correctness (1 when the suggested score falls in the labeled band):",
    '',
    '| Aggregate | ρ |',
    '| --- | --- |',
    aggregateRow('mean', report.confidence.mean),
    aggregateRow('min', report.confidence.min),
    '',
    report.confidence.mean === null && report.confidence.min === null
      ? `Both are undefined (every suggested score falls in its labeled band, or none does), so \`${suggested.confidenceAggregate}\` stays.`
      : `Suggested: \`${suggested.confidenceAggregate}\`.`,
    '',
    '## Suggested `RATING_CONFIG`',
    '',
    '```ts',
    'weights: {',
    ...RATING_DIMENSIONS.map((dimension) => `  ${dimension}: ${weight(suggestedWeights, dimension)},`),
    '},',
    `bands: { great: ${String(suggested.bands.great)}, good: ${String(suggested.bands.good)}, fair: ${String(suggested.bands.fair)} },`,
    `confidenceAggregate: '${suggested.confidenceAggregate}',`,
    '```',
    '',
  ].join('\n');
}

/** `eval` on file contents: the report on stdout and code 0; 1 on a malformed file; 2 on too little data. */
export function runEval(
  labelsText: string,
  answersText: string,
  config: RatingConfig = RATING_CONFIG,
): { code: 0 | 1 | 2; stdout: string; stderr: string } {
  const labels = parseLabelsFile(labelsText);
  if ('error' in labels) return { code: 1, stdout: '', stderr: `Malformed labels file: ${labels.detail}.\n` };
  const answers = parseAnswersFile(answersText);
  if ('error' in answers) return { code: 1, stdout: '', stderr: `Malformed answers file: ${answers.detail}.\n` };
  const report = evaluate(labeledOutfits(labels.entries), answers.answers, config);
  if ('error' in report) {
    const message =
      report.error === 'not_enough_data'
        ? `Not enough data: ${report.detail} Label more outfits.`
        : `Missing answers: ${report.detail} Run \`pnpm calibrate collect\`.`;
    return { code: 2, stdout: '', stderr: `${message}\n` };
  }
  return { code: 0, stdout: formatReport(report, config), stderr: '' };
}

// --- export ------------------------------------------------------------------------------------

export type ExportRows = { profile: unknown; garments: unknown[]; outfits: unknown[] };

/** The user's profile, garments and saved outfits (with their garment ids), read with the service role. */
export async function fetchExportRows(
  env: { supabaseUrl: string; serviceRoleKey: string },
  fetchFn: typeof fetch,
  userId: string,
): Promise<ExportRows> {
  if (!UUID.test(userId)) throw new Error('--user must be a uuid');
  const headers = serviceHeaders(env);
  const rest = `${env.supabaseUrl.replace(/\/+$/, '')}/rest/v1`;
  const [profile] = await restRows(fetchFn, `${rest}/profiles?select=${PROFILE_COLUMNS}&user_id=eq.${userId}`, headers);
  const garments = await restRows(fetchFn, `${rest}/garments?select=${GARMENT_COLUMNS}&user_id=eq.${userId}&order=id`, headers);
  const outfits = await restRows(
    fetchFn,
    `${rest}/outfits?select=id,saved_at,outfit_items(garment_id)&user_id=eq.${userId}&saved_at=not.is.null&order=saved_at`,
    headers,
  );
  return { profile: profile ?? null, garments, outfits };
}

const slotRank = (category: GarmentCategory | null): number =>
  category === null ? SLOTS.length : SLOTS.indexOf(slotOf(category));

/**
 * Each complete saved outfit as an unlabeled entry: the `RatingState` `rate-outfit` would send (via
 * the same `ratingState`), with no occasion (saved outfits don't keep one), no weather, and the
 * season of the day it was saved; plus a readable description to label it by.
 */
export function exportEntries(rows: ExportRows, labeler: string): LabelEntry[] {
  const profile = isRecord(rows.profile) ? profileFrom(rows.profile) : null;
  const garments = new Map(rows.garments.map(garmentFrom).map((garment) => [garment.id, garment]));
  return rows.outfits.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== 'string' || typeof row.saved_at !== 'string' || !Array.isArray(row.outfit_items)) {
      throw new Error('outfits: unexpected row');
    }
    const pieces = (row.outfit_items as unknown[])
      .flatMap((item) => {
        const garment = isRecord(item) && typeof item.garment_id === 'string' ? garments.get(item.garment_id.toLowerCase()) : undefined;
        return garment === undefined ? [] : [garment];
      })
      .sort((a, b) => slotRank(a.category) - slotRank(b.category));
    const date = row.saved_at.slice(0, 10);
    const state = ratingState(profile, { occasion: null, weather: null, season: seasonOf(date, profile?.city_lat ?? null) }, pieces);
    if (!isCompleteOutfit(state.outfit.map((piece) => piece.slot))) return [];
    const description = state.outfit
      .map(({ slot, category, colors }) => `${slot}: ${category}${colors.length > 0 ? ` (${colors.join(', ')})` : ''}`)
      .join('; ');
    return [{ id: row.id, labeler, label: null, description: `Saved ${date}: ${description}`, state }];
  });
}

/** `existing` unchanged (labels kept), then the exported outfits it doesn't have yet. */
export function mergeEntries(existing: readonly LabelEntry[], exported: readonly LabelEntry[]): LabelEntry[] {
  const known = new Set(existing.map(({ id }) => id));
  return [...existing, ...exported.filter(({ id }) => !known.has(id))];
}

// --- collect -----------------------------------------------------------------------------------

/** Labeled outfits with no saved answer yet. */
export function pendingAnswers(entries: readonly LabelEntry[], answered: ReadonlySet<string>): LabelEntry[] {
  return entries.filter(({ id, label }) => label !== null && !answered.has(id));
}

/**
 * Asks `jev` once for every pending outfit (at most `MAX_CONCURRENT_JEV` at once) and adds the
 * bodies that parse to `bodies`; the rest are listed in `failed` and asked again next run.
 */
export async function collectAnswers(
  entries: readonly LabelEntry[],
  bodies: Readonly<Record<string, unknown>>,
  jev: (state: RatingState) => Promise<unknown>,
): Promise<{ bodies: Record<string, unknown>; added: string[]; failed: string[] }> {
  const pending = pendingAnswers(entries, new Set(Object.keys(bodies)));
  const results = await mapLimit(pending, MAX_CONCURRENT_JEV, async ({ id, state }) => {
    try {
      return { id, body: await jev(state) };
    } catch {
      return { id, body: null };
    }
  });
  const added = new Map<string, unknown>();
  const failed: string[] = [];
  for (const { id, body } of results) {
    if (parseJevAnswers(body, RATING_LEVELS) === null) failed.push(id);
    else added.set(id, body);
  }
  return { bodies: { ...bodies, ...Object.fromEntries(added) }, added: [...added.keys()], failed };
}

/**
 * What `collect` prints: the count saved, and the outfits that failed (exit 1). When every call
 * failed, the likely cause is the key or the base URL, so it says so.
 */
export function collectSummary(
  result: { added: readonly string[]; failed: readonly string[] },
  answersPath: string,
): { code: 0 | 1; stdout: string; stderr: string } {
  const stdout = `Saved ${String(result.added.length)} new Jev answer(s) to ${answersPath}.`;
  if (result.failed.length === 0) return { code: 0, stdout, stderr: '' };
  const failed = `Jev gave no usable answer for ${String(result.failed.length)} outfit(s): ${result.failed.join(', ')}. Run collect again.`;
  const hint =
    result.added.length === 0
      ? ' Every call failed: check TYPESAFE_API_KEY and TYPESAFE_BASE_URL (default https://api.typesafe.ai).'
      : '';
  return { code: 1, stdout, stderr: `${failed}${hint}` };
}

// --- CLI ---------------------------------------------------------------------------------------

class UsageError extends Error {}

const USAGE = `Usage:
  node scripts/calibrate.ts export --user <uid> --labeler <name>   (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  node scripts/calibrate.ts collect                                (TYPESAFE_API_KEY, optional TYPESAFE_BASE_URL)
  node scripts/calibrate.ts eval [--labels <file>] [--answers <file>]`;

/** The values of `vars` (name → value read from `process.env`), refusing any that is unset or empty. */
function requireEnv(vars: Record<string, string | undefined>, command: string): string[] {
  const entries = Object.entries(vars);
  const missing = entries.filter(([, value]) => (value ?? '') === '').map(([name]) => name);
  if (missing.length > 0) throw new UsageError(`${command} needs ${missing.join(' and ')} in the environment.`);
  return entries.map(([, value]) => value ?? '');
}

/** The file's text, or undefined when it doesn't exist. */
async function readOptional(path: string): Promise<string | undefined> {
  try {
    // The paths are this script's fixed calibration files or ones the owner passed on the command line.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function readRequired(path: string, hint: string): Promise<string> {
  const text = await readOptional(path);
  if (text === undefined) throw new UsageError(`${path} doesn't exist. ${hint}`);
  return text;
}

/**
 * Writes a calibration file readable by the owner only, since it holds personal data. `mode` only
 * applies when the file is created, so an existing file is narrowed with `chmod` too.
 */
export async function writeLocalJson(path: string, value: unknown): Promise<void> {
  // Same fixed calibration paths as above.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await chmod(path, 0o600);
}

async function existingLabels(): Promise<LabelEntry[]> {
  const text = await readOptional(LABELS_PATH);
  if (text === undefined) return [];
  const parsed = parseLabelsFile(text);
  if ('error' in parsed) throw new UsageError(`Malformed labels file ${LABELS_PATH}: ${parsed.detail}. Fix it first; it was not changed.`);
  return parsed.entries;
}

async function exportCommand(user: string | undefined, labeler: string | undefined): Promise<number> {
  const [supabaseUrl = '', serviceRoleKey = ''] = requireEnv(
    { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY },
    'export',
  );
  if (user === undefined || labeler === undefined || labeler === '') throw new UsageError('export needs --user <uid> and --labeler <name>.');
  const existing = await existingLabels();
  const exported = exportEntries(await fetchExportRows({ supabaseUrl, serviceRoleKey }, fetch, user), labeler);
  const merged = mergeEntries(existing, exported);
  await writeLocalJson(LABELS_PATH, merged);
  console.log(
    `Added ${String(merged.length - existing.length)} outfit(s) to ${LABELS_PATH} (${String(merged.length)} in total). ` +
      'Set each new "label" to "bad", "ok" or "good", then run `pnpm calibrate collect`.',
  );
  return 0;
}

async function collectCommand(): Promise<number> {
  const [typesafeApiKey = ''] = requireEnv({ TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY }, 'collect');
  const typesafeBaseUrl = process.env.TYPESAFE_BASE_URL ?? DEFAULT_TYPESAFE_BASE_URL;
  const labels = parseLabelsFile(await readRequired(LABELS_PATH, 'Run `pnpm calibrate export` first.'));
  if ('error' in labels) throw new UsageError(`Malformed labels file ${LABELS_PATH}: ${labels.detail}.`);
  const answersText = await readOptional(ANSWERS_PATH);
  const saved = answersText === undefined ? { bodies: {} } : parseAnswersFile(answersText);
  if ('error' in saved) throw new UsageError(`Malformed answers file ${ANSWERS_PATH}: ${saved.detail}. Fix or delete it first.`);
  const env = { typesafeApiKey, typesafeBaseUrl };
  const result = await collectAnswers(labels.entries, saved.bodies, (state) =>
    runJev(env, fetch, buildJevRequest(state, Math.random)),
  );
  if (result.added.length > 0) await writeLocalJson(ANSWERS_PATH, result.bodies);
  const summary = collectSummary(result, ANSWERS_PATH);
  console.log(summary.stdout);
  if (summary.stderr !== '') console.error(summary.stderr);
  return summary.code;
}

async function evalCommand(labelsPath: string | undefined, answersPath: string | undefined): Promise<number> {
  const labels = labelsPath === undefined ? LABELS_PATH : resolve(labelsPath);
  const answers = answersPath === undefined ? ANSWERS_PATH : resolve(answersPath);
  const result = runEval(
    await readRequired(labels, 'Run `pnpm calibrate export` and label the outfits first.'),
    await readRequired(answers, 'Run `pnpm calibrate collect` first.'),
  );
  if (result.stdout !== '') process.stdout.write(result.stdout);
  if (result.stderr !== '') process.stderr.write(result.stderr);
  return result.code;
}

async function main(argv: readonly string[]): Promise<number> {
  try {
    let parsed;
    try {
      parsed = parseArgs({
        args: [...argv],
        allowPositionals: true,
        options: {
          user: { type: 'string' },
          labeler: { type: 'string' },
          labels: { type: 'string' },
          answers: { type: 'string' },
        },
      });
    } catch (error) {
      throw new UsageError(error instanceof Error ? error.message : String(error));
    }
    const { positionals, values } = parsed;
    const [command, ...extra] = positionals;
    if (extra.length > 0) throw new UsageError(`Unexpected argument: ${extra.join(' ')}`);
    switch (command) {
      case 'export':
        return await exportCommand(values.user, values.labeler);
      case 'collect':
        return await collectCommand();
      case 'eval':
        return await evalCommand(values.labels, values.answers);
      default:
        throw new UsageError(command === undefined ? 'No command given.' : `Unknown command: ${command}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(error instanceof UsageError ? `${message}\n\n${USAGE}` : `calibrate failed: ${message}`);
    return 1;
  }
}

/** True when `moduleUrl` is the script Node was started with (`process.argv[1]`). */
function isEntryPoint(moduleUrl: string, invokedPath: string | undefined): boolean {
  return invokedPath !== undefined && moduleUrl === pathToFileURL(invokedPath).href;
}

// Guard the entry point so importing this module (e.g. from tests) has no side effects.
if (isEntryPoint(import.meta.url, process.argv[1])) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
