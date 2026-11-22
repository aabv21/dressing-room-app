// `pnpm db:start`: `supabase start` (extra arguments passed through) with a local-only Apple test key in
// `LOCAL_APPLE_PRIVATE_KEY`, generated once into gitignored `supabase/.temp/` (docs/local-stack.md#mock-apple).

import { spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const LOCAL_APPLE_KEY_PATH = fileURLToPath(new URL('../supabase/.temp/apple-test-key.pem', import.meta.url));

/** A new P-256 PKCS#8 key as one line, its newlines written as literal `\n` (what `apple.ts` and the CLI take). */
export function newLocalAppleKey(): string {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  return pem.trim().replace(/\n/g, '\\n');
}

/** The key stored at `path`, generating and writing it (owner-only permissions) first when it's missing. */
export async function ensureLocalAppleKey(path: string = LOCAL_APPLE_KEY_PATH): Promise<string> {
  try {
    // `path` is this script's fixed key path, or a test's temp directory.
    const existing = (await readFile(path, 'utf8')).trim();
    if (existing !== '') return existing;
  } catch (error) {
    // Not `instanceof Error`: Node's fs errors come from another realm under Jest's VM modules.
    const missing = typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
    if (!missing) throw error;
  }
  const key = newLocalAppleKey();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${key}\n`, { encoding: 'utf8', mode: 0o600 });
  return key;
}

async function main(args: readonly string[]): Promise<void> {
  const key = await ensureLocalAppleKey();
  const child = spawn('supabase', ['start', ...args], {
    stdio: 'inherit',
    env: { ...process.env, LOCAL_APPLE_PRIVATE_KEY: key },
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
  child.on('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

function isEntryPoint(moduleUrl: string, invokedPath: string | undefined): boolean {
  return invokedPath !== undefined && moduleUrl === pathToFileURL(invokedPath).href;
}

// Guard the entry point so importing this module (e.g. from tests) has no side effects.
if (isEntryPoint(import.meta.url, process.argv[1])) {
  void main(process.argv.slice(2));
}
