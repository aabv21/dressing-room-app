// scripts/e2e.ts
//
// `pnpm e2e`: runs the Maestro flows in `.maestro/flows` on the booted iOS simulator (or, with
// `E2E_PLATFORM=android`, the connected Android emulator), against the local Supabase stack and the
// mocked AI and weather services, as a fresh `@example.com` user.
// `node scripts/e2e.ts fixtures` regenerates the fictional garment photos in `.maestro/fixtures/`.
//
// Before the flows it checks Java, Maestro, the device (booted, with the dev build installed),
// Metro and the local stack, so a missing piece fails with a message instead of a flow timeout.
// On Android it also maps the emulator's Metro and Supabase ports to the Mac's (`adb reverse`),
// since the app's 127.0.0.1 is the emulator itself. Then it starts `integration/mockServices.ts`
// and `integration/mockAnthropic.ts`, adds the fixtures to the device's photo library and runs
// Maestro. The mocks stop when it ends.
//
// Usage:
//   node scripts/e2e.ts
//   E2E_PLATFORM=android node scripts/e2e.ts
//   node scripts/e2e.ts fixtures

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { fixtureSvg, type FixtureSpec } from './perf-fixtures.ts';

export const APP_ID = 'com.aabv21.dressingroom';
/** Where Homebrew's keg-only `openjdk@17` lives on Apple silicon; used when `JAVA_HOME` is unset. */
export const HOMEBREW_JAVA_HOME = '/opt/homebrew/opt/openjdk@17';
export const METRO_STATUS_URL = 'http://127.0.0.1:8081/status';
/**
 * The category the mocked Jev scores low and names as the weakest piece, so rating an outfit
 * with it offers a swap. `build-rate-swap.yaml` builds an outfit around the T-shirt and swaps it.
 */
export const WEAK_CATEGORY = 't_shirt';
/**
 * A fresh random password for the run's throwaway user (16 URL-safe characters; the local stack
 * wants 8 or more), so no password is committed.
 */
export function e2ePassword(random: Uint8Array = randomBytes(12)): string {
  return Buffer.from(random).toString('base64url');
}
const MOCK_READY_TIMEOUT_MS = 20_000;
const ADD_MEDIA_TIMEOUT_MS = 60_000;

/** The garment photos the first flow picks from the gallery, newest first in the picker. */
export const FIXTURES: readonly { file: string; spec: FixtureSpec }[] = [
  { file: 'jeans.jpg', spec: { shape: 'pants', hue: 215, pattern: 'solid' } },
  { file: 't-shirt.jpg', spec: { shape: 'tee', hue: 350, pattern: 'solid' } },
  { file: 'shirt.jpg', spec: { shape: 'tee', hue: 200, pattern: 'stripes' } },
  { file: 'sneakers.jpg', spec: { shape: 'shoe', hue: 30, pattern: 'dots' } },
];

/** A new address per run (the epoch milliseconds), so no run meets an earlier run's account. */
export function e2eEmail(now: number): string {
  return `e2e-${String(now)}@example.com`;
}

/** Environment variables, as `process.env` holds them. */
export type Env = Readonly<Record<string, string | undefined>>;

export type JavaEnvironment = { ok: true; env: Env } | { ok: false; message: string };

/**
 * The environment Maestro runs with: an existing `JAVA_HOME` is kept; with none, Homebrew's
 * `openjdk@17` is used (its `bin` first on `PATH`) when it exists; otherwise a message saying how
 * to get Java. Never touches the shell profile.
 */
export function javaEnvironment(env: Env, exists: (path: string) => boolean): JavaEnvironment {
  const current = env.JAVA_HOME;
  if (current !== undefined && current !== '') return { ok: true, env };
  if (!exists(join(HOMEBREW_JAVA_HOME, 'bin', 'java'))) {
    return {
      ok: false,
      message: `Maestro needs Java 17: set JAVA_HOME, or install it with \`brew install openjdk@17\` (expected at ${HOMEBREW_JAVA_HOME}).`,
    };
  }
  const path = env.PATH ?? '';
  const bin = join(HOMEBREW_JAVA_HOME, 'bin');
  return {
    ok: true,
    env: { ...env, JAVA_HOME: HOMEBREW_JAVA_HOME, PATH: path === '' ? bin : `${bin}${delimiter}${path}` },
  };
}

/** `maestro test` on `udid`, with the workspace config and the run's account passed to the flows. */
export function maestroArgs(udid: string, email: string, password: string): string[] {
  return [
    '--device',
    udid,
    'test',
    '--config',
    '.maestro/config.yaml',
    '--env',
    `EMAIL=${email}`,
    '--env',
    `PASSWORD=${password}`,
    '.maestro/flows',
  ];
}

/** `xcrun simctl addmedia` for the simulator `udid`. */
export function addMediaArgs(udid: string, files: readonly string[]): string[] {
  return ['simctl', 'addmedia', udid, ...files];
}

/** How a child process ended, as `spawnSync` reports it. */
export type RunResult = { status: number | null; signal: NodeJS.Signals | null; error?: Error };

/** Why `xcrun simctl addmedia` failed, telling a timeout apart from an exit code, or null. */
export function addMediaProblem(result: RunResult, timeoutMs: number): string | null {
  const command = 'xcrun simctl addmedia';
  if (result.status === 0) return null;
  const code = result.error !== undefined && 'code' in result.error ? result.error.code : undefined;
  if (code === 'ETIMEDOUT') return `${command} didn't finish within ${String(timeoutMs / 1000)} s.`;
  if (result.error !== undefined) return `${command} couldn't start: ${result.error.message}.`;
  if (result.signal !== null) return `${command} was stopped by ${result.signal}.`;
  return `${command} exited with ${String(result.status)}.`;
}

export type Simulator = { udid: string; name: string };

/** The booted simulators in `xcrun simctl list devices booted -j` output. */
export function bootedSimulators(listJson: string): Simulator[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(listJson);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null || !('devices' in parsed)) return [];
  const { devices } = parsed;
  if (typeof devices !== 'object' || devices === null) return [];
  return Object.values(devices).flatMap((runtime: unknown) =>
    Array.isArray(runtime)
      ? runtime.flatMap((device: unknown) =>
          typeof device === 'object' &&
          device !== null &&
          'state' in device &&
          device.state === 'Booted' &&
          'name' in device &&
          typeof device.name === 'string' &&
          'udid' in device &&
          typeof device.udid === 'string'
            ? [{ udid: device.udid, name: device.name }]
            : [],
        )
      : [],
  );
}

/**
 * The simulator to run on: the one `requested` names (a UDID or a device name, from
 * `E2E_SIMULATOR`), else the only booted one. Several booted and none requested is an error, since
 * `booted` would pick one of them arbitrarily.
 */
export function pickSimulator(
  booted: readonly Simulator[],
  requested: string | undefined,
  platform: E2ePlatform = 'ios',
): { ok: true; simulator: Simulator } | { ok: false; message: string } {
  const list = booted.map((sim) => (sim.name === sim.udid ? sim.udid : `${sim.name} (${sim.udid})`)).join(', ');
  if (requested !== undefined && requested !== '') {
    const match = booted.find((sim) => sim.udid === requested || sim.name === requested);
    return match === undefined
      ? { ok: false, message: `E2E_SIMULATOR=${requested} isn't running. Running: ${list === '' ? 'none' : list}.` }
      : { ok: true, simulator: match };
  }
  const [only, ...others] = booted;
  if (only === undefined) {
    return {
      ok: false,
      message:
        platform === 'ios'
          ? 'No iOS simulator is booted: boot one, then run `pnpm ios` once.'
          : 'No Android emulator is running: start one, then run `pnpm android` once.',
    };
  }
  if (others.length > 0) {
    return { ok: false, message: `Several devices are running (${list}): pick one with E2E_SIMULATOR=<id or name>.` };
  }
  return { ok: true, simulator: only };
}

export type E2ePlatform = 'ios' | 'android';

/** `E2E_PLATFORM`: `ios` when unset. */
export function e2ePlatform(value: string | undefined): { ok: true; platform: E2ePlatform } | { ok: false; message: string } {
  if (value === undefined || value === '' || value === 'ios') return { ok: true, platform: 'ios' };
  if (value === 'android') return { ok: true, platform: 'android' };
  return { ok: false, message: `E2E_PLATFORM=${value}: use ios or android.` };
}

/** `adb` in the Android SDK: `ANDROID_HOME`, else Android Studio's default `~/Library/Android/sdk`. */
export function adbPath(env: Env, home: string): string {
  const sdk = env.ANDROID_HOME !== undefined && env.ANDROID_HOME !== '' ? env.ANDROID_HOME : join(home, 'Library', 'Android', 'sdk');
  return join(sdk, 'platform-tools', 'adb');
}

/** The ready devices in `adb devices` output, as `{ udid: serial, name: serial }`. */
export function connectedEmulators(devicesOutput: string): Simulator[] {
  return devicesOutput
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .flatMap(([serial, state]) => (serial !== undefined && serial !== '' && state === 'device' ? [{ udid: serial, name: serial }] : []));
}

/** The port of the app's Supabase URL, which `adb reverse` maps into the emulator. */
export function apiPort(appUrl: string): string {
  const url = new URL(appUrl);
  return url.port === '' ? (url.protocol === 'https:' ? '443' : '80') : url.port;
}

/** The fixtures `content query` output doesn't list yet, i.e. that the photo picker can't show. */
export function missingPhotos(queryOutput: string, files: readonly string[]): string[] {
  const listed = new Set(
    queryOutput
      .split('\n')
      .map((line) => /_display_name=(.+)$/.exec(line.trim())?.[1])
      .filter((name): name is string => name !== undefined),
  );
  return files.filter((file) => !listed.has(file));
}

/** Where a fixture goes on the emulator, so its media scan finds it. */
export function androidPhotoPath(file: string): string {
  return `/sdcard/Pictures/${file}`;
}

/** The value of `key` in a dotenv file's text, or undefined. */
export function envValue(text: string, key: string): string | undefined {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith(`${key}=`)) return trimmed.slice(key.length + 1);
  }
  return undefined;
}

/**
 * Why the local stack can't serve the flows, or null when it can: `statusJson` is `supabase status
 * -o json` output (undefined when the command failed, i.e. the stack is stopped) and `appUrl` the
 * `EXPO_PUBLIC_SUPABASE_URL` the app was bundled with.
 */
export function stackProblem(statusJson: string | undefined, appUrl: string | undefined): string | null {
  const start = 'Start the local stack with `pnpm db:start`, then run `pnpm env:local`.';
  if (statusJson === undefined) return `Local Supabase isn't running. ${start}`;
  let status: unknown;
  try {
    // The CLI can print notices around the JSON object.
    status = JSON.parse(statusJson.slice(statusJson.indexOf('{'), statusJson.lastIndexOf('}') + 1));
  } catch {
    return `Couldn't read \`supabase status\`. ${start}`;
  }
  const apiUrl = typeof status === 'object' && status !== null && 'API_URL' in status ? status.API_URL : undefined;
  if (typeof apiUrl !== 'string' || apiUrl === '') return `Local Supabase isn't running. ${start}`;
  if (appUrl === undefined) return 'No EXPO_PUBLIC_SUPABASE_URL in .env.local: run `pnpm env:local`.';
  if (appUrl !== apiUrl) {
    return `.env.local points the app at ${appUrl}, but the local stack is at ${apiUrl}: run \`pnpm env:local\` and restart Metro.`;
  }
  return null;
}

function repoRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function fixturesDir(): string {
  return join(repoRoot(), '.maestro', 'fixtures');
}

async function generateFixtures(): Promise<void> {
  // Imported here so `pnpm e2e` and the tests never load sharp's native binding.
  const sharp = (await import('sharp')).default;
  const dir = fixturesDir();
  // The repo's own fixture folder.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await mkdir(dir, { recursive: true });
  for (const { file, spec } of FIXTURES) {
    // A plain, light product-shot background with room around the garment.
    await sharp(Buffer.from(fixtureSvg(spec, 768)))
      .extend({ top: 128, bottom: 128, left: 128, right: 128, background: '#f3f1f6' })
      .flatten({ background: '#f3f1f6' })
      .jpeg({ quality: 85 })
      .toFile(join(dir, file));
  }
  console.log(`Wrote ${String(FIXTURES.length)} fixtures to ${dir}`);
}

class CheckFailed extends Error {}

function run(
  command: string,
  args: readonly string[],
  env: Env,
  timeout?: number,
): RunResult & { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    cwd: repoRoot(),
    ...(timeout === undefined ? {} : { timeout }),
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status,
    signal: result.signal,
    ...(result.error === undefined ? {} : { error: result.error }),
  };
}

/**
 * Adds the fixtures to the simulator's photo library from a temporary copy: the simulator's media
 * bridge can't open files under a privacy-protected folder such as `~/Documents`, and
 * `simctl addmedia` then waits forever instead of failing.
 */
async function addFixtures(device: Device, env: Env): Promise<void> {
  if (device.platform === 'android') {
    const adb = (args: readonly string[]) => run(device.adb, ['-s', device.udid, ...args], env);
    for (const { file } of FIXTURES) {
      const target = androidPhotoPath(file);
      const pushed = adb(['push', join(fixturesDir(), file), target]);
      if (!pushed.ok) throw new CheckFailed(`adb couldn't copy ${file} to ${device.name}: ${pushed.stderr.trim()}`);
      // `adb push` keeps the Mac file's (old) time; touching it makes the fixtures the newest photos,
      // which are the ones the picker shows first and the flow picks. The scan indexes the new time.
      adb(['shell', 'touch', target]);
      adb(['shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', `file://${target}`]);
    }
    const files = FIXTURES.map(({ file }) => file);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const listed = adb(['shell', 'content', 'query', '--uri', 'content://media/external/images/media', '--projection', '_display_name']);
      const missing = missingPhotos(listed.stdout, files);
      if (missing.length === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new CheckFailed(`${device.name}'s photo library never listed ${files.join(', ')}: the picker couldn't offer them.`);
  }
  const udid = device.udid;
  const staging = await mkdtemp(join(tmpdir(), 'dressing-room-e2e-'));
  try {
    const files = await Promise.all(
      FIXTURES.map(async ({ file }) => {
        const target = join(staging, file);
        await copyFile(join(fixturesDir(), file), target);
        return target;
      }),
    );
    const problem = addMediaProblem(run('xcrun', addMediaArgs(udid, files), env, ADD_MEDIA_TIMEOUT_MS), ADD_MEDIA_TIMEOUT_MS);
    if (problem !== null) throw new CheckFailed(problem);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function metroRunning(): Promise<boolean> {
  try {
    const response = await fetch(METRO_STATUS_URL, { signal: AbortSignal.timeout(3000) });
    return (await response.text()).includes('packager-status:running');
  } catch {
    return false;
  }
}

type Device = Simulator & ({ platform: 'ios' } | { platform: 'android'; adb: string });

async function checkPrerequisites(env: Env, platform: E2ePlatform): Promise<Device> {
  if (!run('maestro', ['--version'], env).ok) {
    throw new CheckFailed('Maestro is not on PATH: install it with `brew install maestro`.');
  }
  let device: Device;
  if (platform === 'android') {
    const adb = adbPath(env, homedir());
    const listed = run(adb, ['devices'], env);
    if (!listed.ok) throw new CheckFailed(`adb didn't run (${adb}): install the Android SDK or set ANDROID_HOME.`);
    const picked = pickSimulator(connectedEmulators(listed.stdout), env.E2E_SIMULATOR, 'android');
    if (!picked.ok) throw new CheckFailed(picked.message);
    device = { ...picked.simulator, platform, adb };
    if (!run(adb, ['-s', device.udid, 'shell', 'pm', 'path', APP_ID], env).stdout.includes('package:')) {
      throw new CheckFailed(`The dev build (${APP_ID}) isn't installed on ${device.name}: run \`pnpm android\`.`);
    }
  } else {
    const booted = bootedSimulators(run('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'], env).stdout);
    const picked = pickSimulator(booted, env.E2E_SIMULATOR);
    if (!picked.ok) throw new CheckFailed(picked.message);
    device = { ...picked.simulator, platform };
    if (!run('xcrun', ['simctl', 'get_app_container', device.udid, APP_ID], env).ok) {
      throw new CheckFailed(`The dev build (${APP_ID}) isn't installed on ${device.name}: run \`pnpm ios\`.`);
    }
  }
  if (!(await metroRunning())) throw new CheckFailed('Metro is not running on :8081: start it with `pnpm start`.');
  const status = run('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], env);
  const envFile = join(repoRoot(), '.env.local');
  // .env.local is this repo's own fixed path.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const envText = existsSync(envFile) ? readFileSync(envFile, 'utf8') : undefined;
  const appUrl = envText === undefined ? undefined : envValue(envText, 'EXPO_PUBLIC_SUPABASE_URL');
  const problem = stackProblem(status.ok ? status.stdout : undefined, appUrl);
  if (problem !== null) throw new CheckFailed(problem);
  if (device.platform === 'android' && appUrl !== undefined) {
    for (const port of ['8081', apiPort(appUrl)]) {
      const mapped = run(device.adb, ['-s', device.udid, 'reverse', `tcp:${port}`, `tcp:${port}`], env);
      if (!mapped.ok) throw new CheckFailed(`adb couldn't map port ${port} into ${device.name}: ${mapped.stderr.trim()}`);
    }
  }
  return device;
}

/** Starts a mock and resolves once it prints its "on :<port>" line; rejects if it exits first. */
function startMock(args: readonly string[]): Promise<ChildProcess> {
  const child = spawn(process.execPath, args, { cwd: repoRoot(), stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGINT');
      reject(new CheckFailed(`${args.join(' ')} didn't start within ${String(MOCK_READY_TIMEOUT_MS / 1000)} s.`));
    }, MOCK_READY_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      process.stdout.write(text);
      if (/ on :\d+/.test(text)) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      const reason = stderr.includes('EADDRINUSE') ? ' (its port is in use: stop the mock already running)' : '';
      reject(new CheckFailed(`${args.join(' ')} exited with ${String(code)}${reason}.\n${stderr.trim()}`));
    });
  });
}

function stopMock(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once('exit', () => {
      resolve();
    });
    child.kill('SIGINT');
  });
}

async function runFlows(): Promise<number> {
  const java = javaEnvironment(process.env, existsSync);
  if (!java.ok) throw new CheckFailed(java.message);
  const platform = e2ePlatform(process.env.E2E_PLATFORM);
  if (!platform.ok) throw new CheckFailed(platform.message);
  const device = await checkPrerequisites(java.env, platform.platform);

  const mocks: ChildProcess[] = [];
  try {
    mocks.push(await startMock(['integration/mockServices.ts', '--serve', '--weak', WEAK_CATEGORY]));
    mocks.push(await startMock(['integration/mockAnthropic.ts', '--serve', 'ok']));

    await addFixtures(device, java.env);

    const email = e2eEmail(Date.now());
    console.log(`Running the flows on ${device.name} as ${email}`);
    const maestro = spawn('maestro', maestroArgs(device.udid, email, e2ePassword()), {
      cwd: repoRoot(),
      env: { ...process.env, ...java.env },
      stdio: 'inherit',
    });
    return await new Promise<number>((resolve) => {
      maestro.once('exit', (code) => {
        resolve(code ?? 1);
      });
      maestro.once('error', (error) => {
        console.error(error.message);
        resolve(1);
      });
    });
  } finally {
    await Promise.all(mocks.map(stopMock));
  }
}

async function main(argv: readonly string[]): Promise<void> {
  if (argv[0] === 'fixtures') {
    await generateFixtures();
    return;
  }
  process.exitCode = await runFlows();
}

/** True when `moduleUrl` is the script Node was started with (`process.argv[1]`). */
export function isEntryPoint(moduleUrl: string, invokedPath: string | undefined): boolean {
  return invokedPath !== undefined && moduleUrl === pathToFileURL(invokedPath).href;
}

// Guard the entry point so importing this module (e.g. from tests) has no side effects.
if (isEntryPoint(import.meta.url, process.argv[1])) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
