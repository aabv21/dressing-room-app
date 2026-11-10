/** @jest-environment node */
// scripts/__tests__/e2e.test.ts
import { delimiter, join } from 'node:path';

import { jevAnswersWithWeakPiece, serveOptionsFrom } from '../../integration/mockServices.ts';
import {
  adbPath,
  addMediaArgs,
  addMediaProblem,
  androidPhotoPath,
  apiPort,
  bootedSimulators,
  connectedEmulators,
  e2eEmail,
  e2ePassword,
  e2ePlatform,
  envValue,
  HOMEBREW_JAVA_HOME,
  javaEnvironment,
  maestroArgs,
  missingPhotos,
  pickSimulator,
  stackProblem,
} from '../e2e.ts';

describe('e2ePassword', () => {
  test('is 16 URL-safe characters, fresh on every run', () => {
    expect(e2ePassword(new Uint8Array(12).fill(255))).toBe('________________');
    expect(e2ePassword()).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(e2ePassword()).not.toBe(e2ePassword());
  });
});

describe('e2eEmail', () => {
  test('is a fresh example.com address per run', () => {
    expect(e2eEmail(1_762_700_000_000)).toBe('e2e-1762700000000@example.com');
    expect(e2eEmail(1)).not.toBe(e2eEmail(2));
  });
});

describe('javaEnvironment', () => {
  const homebrewJava = join(HOMEBREW_JAVA_HOME, 'bin', 'java');

  test('keeps a JAVA_HOME that is already set', () => {
    const env = { JAVA_HOME: '/opt/jdk', PATH: '/usr/bin' };
    expect(javaEnvironment(env, () => true)).toEqual({ ok: true, env });
  });

  test("uses Homebrew's openjdk@17 when JAVA_HOME is unset, its bin first on PATH", () => {
    const result = javaEnvironment({ PATH: '/usr/bin' }, (path) => path === homebrewJava);
    expect(result).toEqual({
      ok: true,
      env: { JAVA_HOME: HOMEBREW_JAVA_HOME, PATH: `${join(HOMEBREW_JAVA_HOME, 'bin')}${delimiter}/usr/bin` },
    });
  });

  test('treats an empty JAVA_HOME as unset', () => {
    const result = javaEnvironment({ JAVA_HOME: '', PATH: '' }, (path) => path === homebrewJava);
    expect(result).toEqual({ ok: true, env: { JAVA_HOME: HOMEBREW_JAVA_HOME, PATH: join(HOMEBREW_JAVA_HOME, 'bin') } });
  });

  test('says how to get Java when there is none', () => {
    const result = javaEnvironment({ PATH: '/usr/bin' }, () => false);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/JAVA_HOME.*brew install openjdk@17/);
  });
});

describe('command arguments', () => {
  test('maestro runs the flows on one simulator with the workspace config and the account', () => {
    expect(maestroArgs('UDID-1', 'e2e-1@example.com', 'secret-pw')).toEqual([
      '--device',
      'UDID-1',
      'test',
      '--config',
      '.maestro/config.yaml',
      '--env',
      'EMAIL=e2e-1@example.com',
      '--env',
      'PASSWORD=secret-pw',
      '.maestro/flows',
    ]);
  });

  test('addmedia targets the picked simulator', () => {
    expect(addMediaArgs('UDID-1', ['/a.jpg', '/b.jpg'])).toEqual(['simctl', 'addmedia', 'UDID-1', '/a.jpg', '/b.jpg']);
  });
});

describe('simulators', () => {
  const list = JSON.stringify({
    devices: {
      'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [
        { udid: 'A', name: 'iPhone 17 Pro', state: 'Booted' },
        { udid: 'B', name: 'iPhone 17', state: 'Shutdown' },
      ],
      'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [{ udid: 'C', name: 'iPhone Air', state: 'Booted' }],
    },
  });

  test('lists only the booted ones', () => {
    expect(bootedSimulators(list)).toEqual([
      { udid: 'A', name: 'iPhone 17 Pro' },
      { udid: 'C', name: 'iPhone Air' },
    ]);
  });

  test('reads malformed output as none booted', () => {
    expect(bootedSimulators('not json')).toEqual([]);
    expect(bootedSimulators('{"devices":null}')).toEqual([]);
  });

  test('picks the only booted simulator', () => {
    expect(pickSimulator([{ udid: 'A', name: 'iPhone 17 Pro' }], undefined)).toEqual({
      ok: true,
      simulator: { udid: 'A', name: 'iPhone 17 Pro' },
    });
  });

  test('asks for E2E_SIMULATOR when several are booted, and matches it by udid or name', () => {
    const booted = bootedSimulators(list);
    const several = pickSimulator(booted, undefined);
    expect(several.ok).toBe(false);
    expect(!several.ok && several.message).toMatch(/E2E_SIMULATOR/);
    expect(pickSimulator(booted, 'C')).toEqual({ ok: true, simulator: { udid: 'C', name: 'iPhone Air' } });
    expect(pickSimulator(booted, 'iPhone 17 Pro')).toEqual({ ok: true, simulator: { udid: 'A', name: 'iPhone 17 Pro' } });
  });

  test("fails when none is booted or the requested one isn't", () => {
    expect(pickSimulator([], undefined).ok).toBe(false);
    const missing = pickSimulator(bootedSimulators(list), 'B');
    expect(!missing.ok && missing.message).toMatch(/E2E_SIMULATOR=B isn't running/);
  });
});

describe('stackProblem', () => {
  const status = JSON.stringify({ API_URL: 'http://127.0.0.1:54421', ANON_KEY: 'anon' });

  test('passes when the stack runs where the app points', () => {
    expect(stackProblem(status, 'http://127.0.0.1:54421')).toBeNull();
  });

  test('tolerates CLI notices around the JSON', () => {
    expect(stackProblem(`Stopped services: [x]\n${status}\nA new version is available`, 'http://127.0.0.1:54421')).toBeNull();
  });

  test('says to start the stack when `supabase status` failed or has no API URL', () => {
    expect(stackProblem(undefined, 'http://127.0.0.1:54421')).toMatch(/isn't running.*pnpm db:start/);
    expect(stackProblem('{}', 'http://127.0.0.1:54421')).toMatch(/isn't running/);
    expect(stackProblem('garbage', 'http://127.0.0.1:54421')).toMatch(/Couldn't read/);
  });

  test('says to run env:local when the app points elsewhere or nowhere', () => {
    expect(stackProblem(status, undefined)).toMatch(/pnpm env:local/);
    expect(stackProblem(status, 'http://127.0.0.1:54321')).toMatch(/54321.*54421.*pnpm env:local/);
  });
});

describe('envValue', () => {
  test('reads one key from a dotenv file', () => {
    const text = 'EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54421\nOTHER=x=y\n';
    expect(envValue(text, 'EXPO_PUBLIC_SUPABASE_URL')).toBe('http://127.0.0.1:54421');
    expect(envValue(text, 'OTHER')).toBe('x=y');
    expect(envValue(text, 'MISSING')).toBeUndefined();
  });
});

describe('the weak-piece Jev mock', () => {
  const request = (categories: string[]) => ({
    state: { outfit: categories.map((category) => ({ category, slot: category === 'jeans' ? 'bottom' : 'top' })) },
    questions: {
      color_harmony: { type: 'score', criteria: ['a', 'b', 'c', 'd', 'e'] },
      clash: { type: 'noul' },
      weakest_piece: { type: 'choice', criteria: { none: 'n', bottom: 'b', top: 't' } },
    },
  });

  test('scores an outfit holding the weak category low and names its slot', () => {
    const { answers } = jevAnswersWithWeakPiece(request(['t_shirt', 'jeans']), 't_shirt', 0.4);
    expect(answers.color_harmony).toEqual({ type: 'score', score: 0.4 * 4, confidence: 0.8 });
    expect(answers.weakest_piece).toEqual({ type: 'choice', choice: 'top', confidence: 0.6 });
  });

  test('scores any other outfit at the best level with no weak piece', () => {
    const { answers } = jevAnswersWithWeakPiece(request(['shirt', 'jeans']), 't_shirt', 0.4);
    expect(answers.color_harmony).toEqual({ type: 'score', score: 4, confidence: 0.8 });
    expect(answers.weakest_piece).toEqual({ type: 'choice', choice: 'none', confidence: 0.6 });
  });
});

describe('addMediaProblem', () => {
  test('a zero exit is no problem', () => {
    expect(addMediaProblem({ status: 0, signal: null }, 60_000)).toBeNull();
  });

  test('a timeout names the time limit', () => {
    const timedOut = Object.assign(new Error('spawnSync xcrun ETIMEDOUT'), { code: 'ETIMEDOUT' });
    expect(addMediaProblem({ status: null, signal: 'SIGTERM', error: timedOut }, 60_000)).toBe(
      "xcrun simctl addmedia didn't finish within 60 s.",
    );
  });

  test('a signal without a timeout names the signal', () => {
    expect(addMediaProblem({ status: null, signal: 'SIGKILL' }, 60_000)).toBe('xcrun simctl addmedia was stopped by SIGKILL.');
  });

  test('a non-zero exit names the exit code', () => {
    expect(addMediaProblem({ status: 2, signal: null }, 60_000)).toBe('xcrun simctl addmedia exited with 2.');
  });

  test('a command that could not start names the error', () => {
    const missing = Object.assign(new Error('spawnSync xcrun ENOENT'), { code: 'ENOENT' });
    expect(addMediaProblem({ status: null, signal: null, error: missing }, 60_000)).toBe(
      "xcrun simctl addmedia couldn't start: spawnSync xcrun ENOENT.",
    );
  });
});

describe('serveOptionsFrom (the mock services CLI)', () => {
  test('defaults to level 1 with no weak piece', () => {
    expect(serveOptionsFrom(['--serve'])).toEqual({ level: 1 });
  });

  test('reads --level, --temp and --weak', () => {
    expect(serveOptionsFrom(['--serve', '--level', '0.4', '--temp', '12'])).toEqual({ level: 0.4, temp: 12 });
    expect(serveOptionsFrom(['--serve', '--weak', 't_shirt'])).toEqual({ level: 1, weak: 't_shirt' });
  });

  test('refuses --level together with --weak, which would ignore the level', () => {
    expect(() => serveOptionsFrom(['--serve', '--level', '0.4', '--weak', 't_shirt'])).toThrow(
      '--level and --weak are exclusive: --weak sets its own answers',
    );
  });

  test('refuses a level out of range and a weak flag without a category', () => {
    expect(() => serveOptionsFrom(['--serve', '--level', '2'])).toThrow('--level must be between 0 and 1');
    expect(() => serveOptionsFrom(['--serve', '--weak'])).toThrow('--weak needs a category');
  });
});

describe('Android target', () => {
  test('E2E_PLATFORM defaults to ios and accepts android only', () => {
    expect(e2ePlatform(undefined)).toEqual({ ok: true, platform: 'ios' });
    expect(e2ePlatform('')).toEqual({ ok: true, platform: 'ios' });
    expect(e2ePlatform('android')).toEqual({ ok: true, platform: 'android' });
    const other = e2ePlatform('windows');
    expect(!other.ok && other.message).toMatch(/use ios or android/);
  });

  test('adb comes from ANDROID_HOME, else Android Studio\'s default SDK', () => {
    expect(adbPath({ ANDROID_HOME: '/sdk' }, '/Users/me')).toBe(join('/sdk', 'platform-tools', 'adb'));
    expect(adbPath({}, '/Users/me')).toBe(join('/Users/me', 'Library', 'Android', 'sdk', 'platform-tools', 'adb'));
  });

  test('lists only ready devices from adb devices', () => {
    const output = 'List of devices attached\nemulator-5554\tdevice\nemulator-5556\toffline\n\n';
    expect(connectedEmulators(output)).toEqual([{ udid: 'emulator-5554', name: 'emulator-5554' }]);
    expect(connectedEmulators('List of devices attached\n\n')).toEqual([]);
  });

  test('asks to start an emulator when none is running, and to pick one when several are', () => {
    const none = pickSimulator([], undefined, 'android');
    expect(!none.ok && none.message).toMatch(/No Android emulator is running/);
    const two = connectedEmulators('List of devices attached\nemulator-5554\tdevice\nemulator-5556\tdevice\n');
    const several = pickSimulator(two, undefined, 'android');
    expect(!several.ok && several.message).toMatch(/E2E_SIMULATOR/);
    expect(pickSimulator(two, 'emulator-5556', 'android')).toEqual({ ok: true, simulator: { udid: 'emulator-5556', name: 'emulator-5556' } });
  });

  test('finds the fixtures the photo library doesn\'t list yet', () => {
    const output = 'Row: 0 _display_name=jeans.jpg\nRow: 1 _display_name=holiday.jpg\nRow: 2 _display_name=shirt.jpg\n';
    expect(missingPhotos(output, ['jeans.jpg', 'shirt.jpg', 'sneakers.jpg'])).toEqual(['sneakers.jpg']);
    expect(missingPhotos('No result found.\n', ['jeans.jpg'])).toEqual(['jeans.jpg']);
  });

  test('maps the Supabase API port and puts fixtures where the media scan finds them', () => {
    expect(apiPort('http://127.0.0.1:54421')).toBe('54421');
    expect(apiPort('https://example.supabase.co')).toBe('443');
    expect(androidPhotoPath('jeans.jpg')).toBe('/sdcard/Pictures/jeans.jpg');
  });
});
