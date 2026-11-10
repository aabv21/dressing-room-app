/** @jest-environment node */
// scripts/__tests__/db-start.test.ts
/* eslint-disable security/detect-non-literal-fs-filename -- every path is under this test's own mkdtemp folder. */
import { createPrivateKey } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ensureLocalAppleKey, LOCAL_APPLE_KEY_PATH, newLocalAppleKey } from '../db-start.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'db-start-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const asPem = (oneLine: string): string => oneLine.replace(/\\n/g, '\n');

test('a new key is one line of PKCS#8 PEM with literal \\n, and a P-256 EC key', () => {
  const key = newLocalAppleKey();

  expect(key).not.toContain('\n');
  expect(key).toMatch(/^-----BEGIN [A-Z ]+-----\\n[\s\S]+\\n-----END [A-Z ]+-----$/);
  const parsed = createPrivateKey(asPem(key));
  expect(parsed.type).toBe('private');
  expect(asPem(key)).toBe(parsed.export({ type: 'pkcs8', format: 'pem' }).trim());
  expect(parsed.asymmetricKeyType).toBe('ec');
  expect(parsed.asymmetricKeyDetails?.namedCurve).toBe('prime256v1');
});

test('generates and writes the key (owner-only) when the file is missing, creating its folder', async () => {
  const path = join(dir, 'nested', 'apple-test-key.pem');

  const key = await ensureLocalAppleKey(path);

  expect((await readFile(path, 'utf8')).trim()).toBe(key);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
});

test('keeps an existing key, so a restart signs with the same one', async () => {
  const path = join(dir, 'apple-test-key.pem');
  const first = await ensureLocalAppleKey(path);

  await expect(ensureLocalAppleKey(path)).resolves.toBe(first);
});

test('replaces an empty file', async () => {
  const path = join(dir, 'apple-test-key.pem');
  await writeFile(path, '\n', 'utf8');

  const key = await ensureLocalAppleKey(path);

  expect(createPrivateKey(asPem(key)).asymmetricKeyType).toBe('ec');
});

test('the default path is the gitignored supabase/.temp/ folder', () => {
  expect(LOCAL_APPLE_KEY_PATH.endsWith(join('supabase', '.temp', 'apple-test-key.pem'))).toBe(true);
});
