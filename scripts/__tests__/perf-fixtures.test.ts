/** @jest-environment node */
// scripts/__tests__/perf-fixtures.test.ts
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  fixtureFileName,
  fixtureSpec,
  fixtureSvg,
  isEntryPoint,
  lanAddresses,
  realInside,
  resolveInside,
} from '../perf-fixtures.ts';

test('specs are deterministic and visually varied across 500 items', () => {
  expect(fixtureSpec(42)).toEqual(fixtureSpec(42));
  const keys = new Set(Array.from({ length: 500 }, (_, i) => JSON.stringify(fixtureSpec(i + 1))));
  expect(keys.size).toBeGreaterThanOrEqual(400);
});

test('file names are zero-padded and 1-based', () => {
  expect(fixtureFileName(1)).toBe('0001.webp');
  expect(fixtureFileName(500)).toBe('0500.webp');
});

test('svg has a transparent background and the requested size', () => {
  const svg = fixtureSvg(fixtureSpec(7), 256);
  expect(svg).toContain('width="256"');
  expect(svg).not.toMatch(/<rect[^>]*width="256"[^>]*height="256"[^>]*fill=/);
});

test('serve rejects paths that escape the fixtures root', () => {
  expect(resolveInside('/root/.perf-fixtures', '/perf/0001.webp')).toBe('/root/.perf-fixtures/perf/0001.webp');
  expect(resolveInside('/root/.perf-fixtures', '/../package.json')).toBeNull();
  expect(resolveInside('/root/.perf-fixtures', '/perf/%2e%2e/%2e%2e/x')).toBeNull();
});

/* eslint-disable security/detect-non-literal-fs-filename -- every path below is under a fresh mkdtemp folder */
test("serve refuses a symlink inside the fixtures that points outside them", async () => {
  const base = await mkdtemp(join(tmpdir(), 'perf-fixtures-'));
  const root = join(base, '.perf-fixtures');
  await mkdir(join(root, 'perf'), { recursive: true });
  await writeFile(join(root, 'perf', '0001.webp'), 'ok');
  await writeFile(join(base, 'secret.txt'), 'nope');
  await symlink(join(base, 'secret.txt'), join(root, 'perf', 'link.webp'));

  await expect(realInside(root, join(root, 'perf', '0001.webp'))).resolves.toBe(await realpath(join(root, 'perf', '0001.webp')));
  await expect(realInside(root, join(root, 'perf', 'link.webp'))).resolves.toBeNull();
  await expect(realInside(root, join(root, 'perf', 'missing.webp'))).resolves.toBeNull();
  await rm(base, { recursive: true, force: true });
});
/* eslint-enable security/detect-non-literal-fs-filename */

test('every non-internal IPv4 address is listed with its interface name', () => {
  const ipv4 = (address: string, internal: boolean) => ({
    address,
    netmask: '255.255.255.0',
    family: 'IPv4' as const,
    mac: '00:00:00:00:00:00',
    internal,
    cidr: null,
  });
  const ipv6 = {
    address: 'fe80::1',
    netmask: 'ffff:ffff:ffff:ffff::',
    family: 'IPv6' as const,
    mac: '00:00:00:00:00:00',
    internal: false,
    cidr: null,
    scopeid: 1,
  };
  expect(
    lanAddresses({
      lo0: [ipv4('127.0.0.1', true)],
      en0: [ipv6, ipv4('192.168.1.20', false)],
      utun3: [ipv4('100.64.0.5', false)],
      bridge100: undefined,
    }),
  ).toEqual([
    { name: 'en0', address: '192.168.1.20' },
    { name: 'utun3', address: '100.64.0.5' },
  ]);
});

test('the entry guard matches paths that need URL encoding', () => {
  const path = '/Users/someone/My Projects/dressing-room-app/scripts/perf-fixtures.ts';
  expect(isEntryPoint(pathToFileURL(path).href, path)).toBe(true);
  expect(isEntryPoint(pathToFileURL(path).href, '/elsewhere/perf-fixtures.ts')).toBe(false);
  expect(isEntryPoint(pathToFileURL(path).href, undefined)).toBe(false);
});
