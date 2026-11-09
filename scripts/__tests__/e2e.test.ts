/** @jest-environment node */
// scripts/__tests__/e2e.test.ts
import { delimiter, join } from 'node:path';

import { jevAnswersWithWeakPiece } from '../../integration/mockServices.ts';
import {
  addMediaArgs,
  bootedSimulators,
  e2eEmail,
  envValue,
  HOMEBREW_JAVA_HOME,
  javaEnvironment,
  maestroArgs,
  pickSimulator,
  stackProblem,
} from '../e2e.ts';

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
    expect(!missing.ok && missing.message).toMatch(/E2E_SIMULATOR=B isn't booted/);
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
