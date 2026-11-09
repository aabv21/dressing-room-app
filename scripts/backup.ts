// scripts/backup.ts
//
// `pnpm backup` (`node scripts/backup.ts`): a local export of the hosted project, run on the owner's
// Mac by launchd (see `docs/database.md`'s "Hosted backups"). The free tier has no downloadable
// backups, so this script takes one:
//
//   1. `schema.sql` and `data.sql` from `pnpm exec supabase db dump --db-url $BACKUP_DB_URL` (the
//      repo's own CLI, which runs pg_dump in Docker). The data dump covers `public`, `auth` and
//      `storage`'s object rows.
//   2. Every object in the `garments` bucket, under `garments/<path>`, read with the service role
//      through Storage's REST API.
//   3. `manifest.json`: each file's path, size and sha256.
//
// Everything is written to `<BACKUP_DIR>/<UTC timestamp>.partial/`, renamed to `<UTC timestamp>/`
// only once complete; then all but the newest `KEEP_BACKUPS` complete backups are deleted. A run
// that fails at any step exits 1 and leaves its `.partial` folder for inspection, and never
// rotates; each run starts by deleting `.partial` folders over `STALE_PARTIAL_DAYS` old and logging
// the age of the newest complete backup. A backup is credential material (password hashes, refresh
// tokens), so every file is 0600 and every folder 0700. Logs carry outcome words only: secrets and
// connection strings are redacted. The database password never reaches a command line (where `ps`
// shows it): the dump gets the URL without it and the password in `PGPASSWORD`.
//
// Env: BACKUP_DB_URL (the hosted connection string, percent-encoded), SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, and optionally BACKUP_DIR (default `~/dressing-room-backups`, never
// inside this repository).
//
// `node scripts/backup.ts --verify <backup folder>` recomputes every size and sha256 in the
// folder's `manifest.json` and exits 1 on any difference (run it before a restore).

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isRecord } from '../supabase/functions/_shared/extraction.ts';
import { mapLimit, serviceHeaders } from '../supabase/functions/_shared/userContext.ts';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const BUCKET = 'garments';

/** How many complete backups rotation keeps. */
export const KEEP_BACKUPS = 14;
/** Storage's list page size. */
export const LIST_PAGE = 1000;
/** Folder listings and downloads in flight at once. */
export const DOWNLOAD_CONCURRENCY = 4;
/** A `.partial` folder older than this is deleted at the start of the next run. */
const STALE_PARTIAL_DAYS = 7;
const DAY_MS = 86_400_000;
/** Each Storage request's limit, so a stalled connection fails the run instead of hanging it. */
const FETCH_TIMEOUT_MS = 60_000;
/** Each dump's limit. */
const DUMP_TIMEOUT_MS = 30 * 60_000;
/**
 * Tables left out of the data dump, so it restores on top of the migrations as `postgres`: the
 * bucket row is created by a migration (restoring it would collide), the `postgres` role can't
 * write Storage's vector tables (this project uses none), and pg_net's queue and responses are
 * transient.
 */
const DATA_DUMP_EXCLUDE = [
  'storage.buckets',
  'storage.buckets_vectors',
  'storage.vector_indexes',
  'net.http_request_queue',
  'net._http_response',
].join(',');

/** A complete backup's folder name: `backupDirName`'s shape. */
const BACKUP_NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/;
/** An unfinished run's folder: a backup name plus `.partial`. */
const PARTIAL_NAME = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.partial$/;

export type ManifestEntry = { path: string; size: number; sha256: string };

export type BackupConfig = {
  /** `BACKUP_DB_URL` without its password. */
  dbUrl: string;
  /** `BACKUP_DB_URL`'s password, percent-decoded; empty when the URL has none. */
  dbPassword: string;
  supabaseUrl: string;
  serviceRoleKey: string;
  backupRoot: string;
};

export type CommandResult = { code: number; stderr: string };

/**
 * Runs `command` with `args` from the repository root, with `env` added to its environment,
 * resolving with its exit code and stderr.
 */
export type RunCommand = (command: string, args: readonly string[], env: Readonly<Record<string, string>>) => Promise<CommandResult>;

export type BackupDeps = {
  config: BackupConfig;
  now: Date;
  run: RunCommand;
  fetch: typeof fetch;
  log: (line: string) => void;
};

/** `now` in UTC as `YYYY-MM-DDTHH-mm-ssZ` (a file-name-safe ISO time, which sorts by age). */
export function backupDirName(now: Date): string {
  return `${now.toISOString().slice(0, 19).replace(/:/g, '-')}Z`;
}

/**
 * The complete backups in `existing` (folder names) to delete so the newest `keep` remain, newest
 * first. A `.partial` folder or any other name is never returned.
 */
export function rotate(existing: readonly string[], keep: number): string[] {
  const complete = existing.filter((name) => BACKUP_NAME.test(name)).sort((a, b) => b.localeCompare(a));
  return complete.slice(Math.max(0, keep));
}

/**
 * The `.partial` folders in `names` whose embedded UTC time is more than `maxAgeDays` before `now`.
 * Complete backups, other names and impossible times are never returned.
 */
export function stalePartials(names: readonly string[], now: Date, maxAgeDays: number): string[] {
  return names.filter((name) => {
    const match = PARTIAL_NAME.exec(name);
    if (match === null) return false;
    const [, day = '', hours = '', minutes = '', seconds = ''] = match;
    const time = new Date(`${day}T${hours}:${minutes}:${seconds}Z`);
    // A time that doesn't round-trip (2026-02-30) isn't one this script wrote.
    if (Number.isNaN(time.getTime()) || `${backupDirName(time)}.partial` !== name) return false;
    return now.getTime() - time.getTime() > maxAgeDays * DAY_MS;
  });
}

/** A complete backup name's time; null for any other name. */
function timeOfBackup(name: string): Date | null {
  if (!BACKUP_NAME.test(name)) return null;
  const time = new Date(`${name.slice(0, 13)}:${name.slice(14, 16)}:${name.slice(17, 19)}Z`);
  return Number.isNaN(time.getTime()) ? null : time;
}

export function manifestEntry(path: string, bytes: Uint8Array): ManifestEntry {
  return { path, size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** `text` with every non-empty secret and any Postgres connection string replaced. */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets.filter((value) => value.length > 0)) out = out.split(secret).join('[redacted]');
  return out.replace(/postgres(?:ql)?:\/\/\S+/g, '[database url]');
}

const listOf = (names: readonly string[]): string =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;

/** `url` split into the URL without its password and the decoded password, or why it can't be. */
function splitDbUrl(url: string): { dbUrl: string; dbPassword: string } | { error: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    parsed = new URL('invalid:');
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    return { error: 'BACKUP_DB_URL must be a postgresql:// connection string' };
  }
  let dbPassword: string;
  try {
    dbPassword = decodeURIComponent(parsed.password);
  } catch {
    return {
      error: "BACKUP_DB_URL's password is not valid percent-encoding: percent-encode its special characters (@ as %40, % as %25, / as %2F)",
    };
  }
  parsed.password = '';
  return { dbUrl: parsed.href, dbPassword };
}

/**
 * The run's settings from `env`, or why they're unusable (never echoing a value). BACKUP_DIR may
 * start with `~/`; it must be absolute otherwise, and never inside `repoRoot`, since backups hold
 * personal data.
 */
export function backupConfigFrom(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
  repoRoot: string,
): BackupConfig | { error: string } {
  const { BACKUP_DB_URL: fullDbUrl = '', SUPABASE_URL: supabaseUrl = '', SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey = '' } = env;
  const required = { BACKUP_DB_URL: fullDbUrl, SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey };
  const missing = Object.entries(required)
    .filter(([, value]) => value === '')
    .map(([name]) => name);
  if (missing.length > 0) return { error: `missing ${listOf(missing)} in the environment` };
  const db = splitDbUrl(fullDbUrl);
  if ('error' in db) return db;

  const dir = env.BACKUP_DIR ?? '';
  let backupRoot: string;
  if (dir === '') backupRoot = join(home, 'dressing-room-backups');
  else if (dir === '~' || dir.startsWith('~/')) backupRoot = resolve(home, dir.slice(2));
  else if (isAbsolute(dir)) backupRoot = resolve(dir);
  else return { error: 'BACKUP_DIR must be an absolute path or start with ~/' };

  const fromRepo = relative(resolve(repoRoot), backupRoot);
  if (fromRepo === '' || (fromRepo !== '..' && !fromRepo.startsWith(`..${sep}`) && !isAbsolute(fromRepo))) {
    return { error: 'BACKUP_DIR must be outside the repository: backups hold personal data' };
  }

  return { ...db, supabaseUrl: supabaseUrl.replace(/\/+$/, ''), serviceRoleKey, backupRoot };
}

/** A failed step; its message is logged after redaction. */
class StepError extends Error {}

/** An error's message, also for errors from another realm (Node's fs errors under Jest's VM modules). */
function messageOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return String(error);
}

/** The last few meaningful stderr lines of a failed dump, without the CLI's upgrade notice. */
function stderrTail(stderr: string): string {
  const lines = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !/new version of Supabase CLI|recommend updating regularly/.test(line));
  return lines.slice(-5).join(' | ');
}

async function dump(deps: BackupDeps, what: string, extraArgs: readonly string[], file: string): Promise<void> {
  const args = ['exec', 'supabase', 'db', 'dump', '--db-url', deps.config.dbUrl, ...extraArgs, '-f', file];
  const env: Record<string, string> = deps.config.dbPassword === '' ? {} : { PGPASSWORD: deps.config.dbPassword };
  const result = await deps.run('pnpm', args, env);
  if (result.code !== 0) throw new StepError(`${what} dump failed (exit ${String(result.code)}): ${stderrTail(result.stderr)}`);
  // The CLI creates the file; make it owner-only whatever the umask was.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await chmod(file, 0o600);
  deps.log(`backup: ${what} dump ok`);
}

const storageUrl = (config: BackupConfig, route: string): string => `${config.supabaseUrl}/storage/v1/${route}`;

/** An object path as a URL path, each segment encoded. */
const encodePath = (path: string): string => path.split('/').map(encodeURIComponent).join('/');

/** A name Storage returned for one level: one plain path segment that can't leave its folder. */
const isSafeSegment = (name: string): boolean =>
  name !== '' && name !== '.' && name !== '..' && !/[/\\\0]/.test(name);

/**
 * The files and folders one level under `prefix` (`''` for the bucket root, else ending in `/`),
 * paged until an empty page: a short page alone doesn't prove the end, since the server may cap a
 * page below `LIST_PAGE`.
 */
async function listLevel(deps: BackupDeps, prefix: string): Promise<{ files: string[]; folders: string[] }> {
  const files: string[] = [];
  const folders: string[] = [];
  for (let offset = 0; ; ) {
    const response = await deps.fetch(storageUrl(deps.config, `object/list/${BUCKET}`), {
      method: 'POST',
      headers: { ...serviceHeaders(deps.config), 'content-type': 'application/json' },
      body: JSON.stringify({ prefix, limit: LIST_PAGE, offset, sortBy: { column: 'name', order: 'asc' } }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new StepError(`storage list failed: HTTP ${String(response.status)}`);
    const page: unknown = await response.json();
    if (!Array.isArray(page)) throw new StepError('storage list failed: not an array');
    if (page.length === 0) return { files, folders };
    offset += page.length;
    for (const entry of page as unknown[]) {
      if (!isRecord(entry) || typeof entry.name !== 'string' || !isSafeSegment(entry.name)) {
        throw new StepError('storage list failed: unexpected entry');
      }
      // Storage lists a folder as an entry with a null id.
      if (entry.id === null) folders.push(`${prefix}${entry.name}/`);
      else files.push(`${prefix}${entry.name}`);
    }
  }
}

/** Every object path under `prefix`, at any depth. */
async function listObjects(deps: BackupDeps, prefix: string): Promise<string[]> {
  const { files, folders } = await listLevel(deps, prefix);
  const nested = await mapLimit(folders, DOWNLOAD_CONCURRENCY, (folder) => listObjects(deps, folder));
  return [...files, ...nested.flat()];
}

/** Downloads `path` into `<dir>/garments/<path>`; any non-2xx answer, a 404 included, fails the run. */
async function downloadObject(deps: BackupDeps, dir: string, path: string, stop: AbortSignal): Promise<ManifestEntry> {
  const response = await deps.fetch(storageUrl(deps.config, `object/${BUCKET}/${encodePath(path)}`), {
    headers: serviceHeaders(deps.config),
    signal: AbortSignal.any([stop, AbortSignal.timeout(FETCH_TIMEOUT_MS)]),
  });
  if (!response.ok) throw new StepError(`storage download failed: HTTP ${String(response.status)}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const relativePath = `${BUCKET}/${path}`;
  const file = join(dir, ...relativePath.split('/'));
  // `file` is under this run's own folder: every segment passed `isSafeSegment`.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await writeFile(file, bytes, { mode: 0o600 });
  return manifestEntry(relativePath, bytes);
}

/**
 * Downloads every path, `DOWNLOAD_CONCURRENCY` at a time. After the first failure no download
 * starts and the ones in flight are aborted; the first error is thrown.
 */
async function downloadAll(deps: BackupDeps, dir: string, paths: readonly string[]): Promise<ManifestEntry[]> {
  const stop = new AbortController();
  const entries: ManifestEntry[] = [];
  const failures: unknown[] = [];
  const queue = paths.values();
  const worker = async (): Promise<void> => {
    for (const path of queue) {
      if (stop.signal.aborted) return;
      try {
        entries.push(await downloadObject(deps, dir, path, stop.signal));
      } catch (error) {
        failures.push(error);
        stop.abort();
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, paths.length) }, worker));
  // The first failure is the cause; the rest are usually aborts it triggered.
  if (failures.length > 0) throw failures[0];
  return entries;
}

/** The manifest entry of a file already written under `dir`. */
async function entryOf(dir: string, relativePath: string): Promise<ManifestEntry> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return manifestEntry(relativePath, new Uint8Array(await readFile(join(dir, relativePath))));
}

/** The secrets a log line must never show: the key and the DB password (decoded and encoded). */
const secretsOf = (config: BackupConfig): string[] => [
  config.serviceRoleKey,
  config.dbPassword,
  encodeURIComponent(config.dbPassword),
];

/**
 * Deletes the `.partial` folders over `STALE_PARTIAL_DAYS` old and logs the newest complete
 * backup's age, so even a failing run's log says how old the last good backup is.
 */
async function tidyAndReport(deps: BackupDeps): Promise<void> {
  const { backupRoot } = deps.config;
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const names = await readdir(backupRoot);
  const stale = stalePartials(names, deps.now, STALE_PARTIAL_DAYS);
  for (const old of stale) await rm(join(backupRoot, old), { recursive: true, force: true });
  if (stale.length > 0) deps.log(`backup: deleted ${String(stale.length)} stale .partial folder${stale.length === 1 ? '' : 's'}`);

  const newest = names.filter((name) => timeOfBackup(name) !== null).sort().at(-1);
  const time = newest === undefined ? null : timeOfBackup(newest);
  if (newest === undefined || time === null) {
    deps.log('backup: no complete backup yet');
  } else {
    const days = (deps.now.getTime() - time.getTime()) / DAY_MS;
    deps.log(`backup: newest complete backup is ${newest}, ${days.toFixed(1)} days old`);
  }
}

/** Takes one backup (see the module comment); resolves with the process exit code. */
export async function runBackup(deps: BackupDeps): Promise<number> {
  const { backupRoot } = deps.config;
  const name = backupDirName(deps.now);
  const partial = join(backupRoot, `${name}.partial`);
  const secrets = secretsOf(deps.config);
  let created = false;
  try {
    // The root holds personal data: owner-only, also when it already existed with looser modes.
    // `backupRoot` comes from the owner's own env.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await mkdir(backupRoot, { recursive: true, mode: 0o700 });
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await chmod(backupRoot, 0o700);
    await tidyAndReport(deps);
    // Not recursive: a folder left by another run in the same second fails here.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await mkdir(partial, { mode: 0o700 });
    created = true;

    await dump(deps, 'schema', [], join(partial, 'schema.sql'));
    await dump(deps, 'data', ['--data-only', '--use-copy', '-x', DATA_DUMP_EXCLUDE], join(partial, 'data.sql'));

    const paths = await listObjects(deps, '');
    const objects = await downloadAll(deps, partial, paths);
    deps.log(`backup: ${String(objects.length)} storage objects ok`);

    const files = [
      await entryOf(partial, 'schema.sql'),
      await entryOf(partial, 'data.sql'),
      ...objects.sort((a, b) => a.path.localeCompare(b.path)),
    ];
    const manifest = { createdAt: deps.now.toISOString(), files };
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await writeFile(join(partial, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await rename(partial, join(backupRoot, name));
  } catch (error) {
    const left = created ? `; ${name}.partial left for inspection` : '';
    deps.log(`backup: failed: ${redact(messageOf(error), secrets)}${left}`);
    return 1;
  }
  deps.log(`backup: complete ${name}`);

  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const stale = rotate(await readdir(backupRoot), KEEP_BACKUPS);
    for (const old of stale) {
      await rm(join(backupRoot, old), { recursive: true, force: true });
    }
    if (stale.length > 0) deps.log(`backup: rotated ${String(stale.length)} old backups`);
  } catch (error) {
    deps.log(`backup: complete, but rotation failed: ${redact(messageOf(error), secrets)}`);
    return 1;
  }
  return 0;
}

const isManifestEntry = (value: unknown): value is ManifestEntry =>
  isRecord(value) && typeof value.path === 'string' && typeof value.size === 'number' && typeof value.sha256 === 'string';

/**
 * Recomputes every size and sha256 that `<dir>/manifest.json` lists. `problems` names each file
 * that is missing or differs; a missing or malformed manifest, or a path that would leave `dir`, is
 * a problem too.
 */
export async function verifyBackup(dir: string): Promise<{ files: number; problems: string[] }> {
  let entries: ManifestEntry[];
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const manifest: unknown = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
    if (!isRecord(manifest) || !Array.isArray(manifest.files)) throw new Error('malformed');
    const files = manifest.files as unknown[];
    if (!files.every(isManifestEntry)) throw new Error('malformed');
    entries = files;
  } catch {
    return { files: 0, problems: ['manifest.json is missing or malformed'] };
  }
  const problems: string[] = [];
  for (const entry of entries) {
    if (!entry.path.split('/').every(isSafeSegment)) {
      problems.push(`${entry.path}: unsafe path`);
      continue;
    }
    let bytes: Uint8Array;
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      bytes = new Uint8Array(await readFile(join(dir, ...entry.path.split('/'))));
    } catch {
      problems.push(`${entry.path}: missing`);
      continue;
    }
    const actual = manifestEntry(entry.path, bytes);
    if (actual.size !== entry.size || actual.sha256 !== entry.sha256) problems.push(`${entry.path}: size or sha256 differs`);
  }
  return { files: entries.length, problems };
}

/**
 * Spawns `command` from the repository root, so `pnpm exec supabase` is this repo's CLI. The child
 * gets this process's env plus `env`, minus the URL with the password and the service-role key,
 * which it doesn't need.
 */
const runCommand: RunCommand = (command, args, env) =>
  new Promise((resolveResult, reject) => {
    const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
    delete childEnv.BACKUP_DB_URL;
    delete childEnv.SUPABASE_SERVICE_ROLE_KEY;
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env: childEnv,
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: DUMP_TIMEOUT_MS,
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-16_384);
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolveResult({ code: code ?? 1, stderr: signal === null ? stderr : `${stderr}\nstopped by ${signal}` });
    });
  });

async function verifyCommand(dir: string | undefined): Promise<number> {
  if (dir === undefined || dir === '') {
    console.error('usage: node scripts/backup.ts --verify <backup folder>');
    return 1;
  }
  const { files, problems } = await verifyBackup(resolve(dir));
  for (const problem of problems) console.error(`verify: ${problem}`);
  console.log(`verify: ${String(files)} files, ${String(problems.length)} problems`);
  return problems.length === 0 ? 0 : 1;
}

async function main(args: readonly string[]): Promise<number> {
  // Everything this process creates is owner-only (the dump files are written by the CLI child,
  // which inherits this umask).
  process.umask(0o077);
  if (args[0] === '--verify') return verifyCommand(args[1]);
  const config = backupConfigFrom(process.env, homedir(), REPO_ROOT);
  if ('error' in config) {
    console.error(`backup: ${config.error}`);
    return 1;
  }
  return runBackup({
    config,
    now: new Date(),
    run: runCommand,
    fetch: globalThis.fetch,
    log: (line) => {
      console.log(`${new Date().toISOString()} ${line}`);
    },
  });
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
