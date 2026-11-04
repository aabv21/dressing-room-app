// scripts/env-local.ts
//
// Generates `.env.local` from the running local Supabase stack's `supabase status -o env`
// output: the two EXPO_PUBLIC_* keys the app bundles, plus the service-role key and DB URL used
// only by scripts and integration tests (never read from src/).
//
// Usage:
//   node scripts/env-local.ts

import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ENV_FILE_PATH = fileURLToPath(new URL('../.env.local', import.meta.url));

/** The keys this script owns; every other line in an existing `.env.local` is left untouched. */
const OWNED_KEYS: ReadonlySet<string> = new Set([
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
]);

/**
 * Maps `supabase status -o env` output to the app and test variables, in a fixed order. Throws if
 * `API_URL` or `ANON_KEY` is missing — the two keys the app cannot run without.
 *
 * When `existing` (an already-read `.env.local`) is given, this merges rather than clobbers: the
 * four Supabase keys are (re)written in their fixed order first, and every other line from
 * `existing` — e.g. `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, set by hand or by the integration session —
 * is kept, in its original order, after them. Without `existing`, the result is just the four keys,
 * matching the previous (pre-merge) behavior.
 */
export function toEnvFile(statusEnv: Readonly<Record<string, string>>, existing?: string): string {
  const apiUrl = statusEnv['API_URL'];
  if (apiUrl === undefined) {
    throw new Error('supabase status -o env did not include API_URL');
  }
  const anonKey = statusEnv['ANON_KEY'];
  if (anonKey === undefined) {
    throw new Error('supabase status -o env did not include ANON_KEY');
  }

  const lines = [`EXPO_PUBLIC_SUPABASE_URL=${apiUrl}`, `EXPO_PUBLIC_SUPABASE_ANON_KEY=${anonKey}`];

  const serviceRoleKey = statusEnv['SERVICE_ROLE_KEY'];
  if (serviceRoleKey !== undefined) {
    lines.push(`SUPABASE_SERVICE_ROLE_KEY=${serviceRoleKey}`);
  }
  const dbUrl = statusEnv['DB_URL'];
  if (dbUrl !== undefined) {
    lines.push(`SUPABASE_DB_URL=${dbUrl}`);
  }

  if (existing !== undefined) {
    for (const line of existing.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') {
        continue;
      }
      const separatorIndex = trimmed.indexOf('=');
      const key = separatorIndex === -1 ? trimmed : trimmed.slice(0, separatorIndex);
      if (!OWNED_KEYS.has(key)) {
        lines.push(line);
      }
    }
  }

  return `${lines.join('\n')}\n`;
}

/** Parses `KEY=value` lines from `supabase status -o env` output into a plain object. */
function parseStatusEnv(output: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') {
      continue;
    }
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex);
    let value = trimmed.slice(separatorIndex + 1);
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

/** Reads the current `.env.local`, or `undefined` if it doesn't exist yet (a first run). */
async function readExistingEnvFile(): Promise<string | undefined> {
  try {
    return await readFile(ENV_FILE_PATH, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const [{ stdout }, existing] = await Promise.all([
    execFileAsync('pnpm', ['exec', 'supabase', 'status', '-o', 'env']),
    readExistingEnvFile(),
  ]);
  const statusEnv = parseStatusEnv(stdout);
  const contents = toEnvFile(statusEnv, existing);
  await writeFile(ENV_FILE_PATH, contents, 'utf8');
  console.log(`Wrote ${ENV_FILE_PATH}`);
}

/** True when `moduleUrl` is the script Node was started with (`process.argv[1]`). */
export function isEntryPoint(moduleUrl: string, invokedPath: string | undefined): boolean {
  return invokedPath !== undefined && moduleUrl === pathToFileURL(invokedPath).href;
}

// Guard the entry point so importing this module (e.g. from tests) has no side effects.
if (isEntryPoint(import.meta.url, process.argv[1])) {
  void main();
}
