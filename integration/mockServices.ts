// integration/mockServices.ts
//
// Stand-ins for TypeSafe's System One API (Jev) and Open-Meteo's forecast and geocoding APIs, so
// the local `rate-outfit` and `lucky-list` Edge Functions run end to end without a key or the
// network. The local Edge Runtime points `TYPESAFE_BASE_URL`, `OPEN_METEO_URL` and
// `OPEN_METEO_GEOCODING_URL` at `http://host.docker.internal:54498` (see `supabase/config.toml`),
// so this listens on every interface, not only loopback: the requests come from inside a
// container. One server answers all three, routed by path.

import { createServer, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';

import type { MockReply } from './mockAnthropic';

export type { MockReply };

/** A Jev reply, or one computed from each request's parsed JSON body (`undefined` if it isn't JSON). */
export type JevReply = MockReply | ((body: unknown) => MockReply);

export type MockServices = {
  /** Sets the reply for every following `POST /v1/systemone`, until changed again. */
  jev(next: JevReply): void;
  /** Sets the reply for every following `GET /v1/forecast`. */
  forecast(next: MockReply): void;
  /** Sets the reply for every following `GET /v1/search` (geocoding). */
  geocode(next: MockReply): void;
  /** How many calls have arrived so far on `path` (`/v1/systemone`, `/v1/forecast` or `/v1/search`). */
  calls(path: string): number;
  close(): Promise<void>;
};

const JEV_PATH = '/v1/systemone';
const FORECAST_PATH = '/v1/forecast';
const GEOCODE_PATH = '/v1/search';

/** A mild, dry, clear day: (22 + 16) / 2 = 19 °C is `mild`, 10 % rain chance, WMO code 1. */
export const MILD_FORECAST = {
  current: { temperature_2m: 19.5, weather_code: 1 },
  daily: { temperature_2m_max: [22], temperature_2m_min: [16], precipitation_probability_max: [10] },
};

/** Madrid's first geocoding result. */
export const MADRID_GEOCODE = {
  results: [{ name: 'Madrid', latitude: 40.4168, longitude: -3.7038, country_code: 'ES' }],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A well-formed System One response answering every question in `request`: each Score question
 * at `level` of its range (0 = its worst criterion, 1 = its best), each Noul well below the
 * hard-failure threshold, and each Choice with `none` when offered (else its first `criteria`
 * key). With every Score at the same level, the composite rating is `round(100 · level)`.
 */
export function jevAnswers(request: unknown, level = 1): { model: string; answers: Record<string, unknown> } {
  const questions: Record<string, unknown> = isRecord(request) && isRecord(request.questions) ? request.questions : {};
  const answers = Object.fromEntries(
    Object.entries(questions).map(([id, question]): [string, unknown] => {
      if (!isRecord(question)) return [id, null];
      if (question.type === 'score') {
        const top = Array.isArray(question.criteria) ? question.criteria.length - 1 : 0;
        return [id, { type: 'score', score: level * top, confidence: 0.8 }];
      }
      if (question.type === 'noul') return [id, { type: 'noul', noul: 0.02 }];
      if (question.type === 'choice') {
        const options = isRecord(question.criteria) ? Object.keys(question.criteria) : [];
        return [id, { type: 'choice', choice: options.includes('none') ? 'none' : (options[0] ?? null), confidence: 0.6 }];
      }
      return [id, null];
    }),
  );
  return { model: 'jev-mock', answers };
}

const DEFAULT_JEV: JevReply = (body) => ({ status: 200, body: jevAnswers(body) });

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Starts the mock on `port`. Until a test sets its own, Jev answers every question at the best
 * level, the forecast is `MILD_FORECAST` and geocoding finds Madrid.
 */
export function startMockServices(port = 54498): Promise<MockServices> {
  let jevReply: JevReply = DEFAULT_JEV;
  let forecastReply: MockReply = { status: 200, body: MILD_FORECAST };
  let geocodeReply: MockReply = { status: 200, body: MADRID_GEOCODE };
  const callCounts = new Map<string, number>();

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      const path = new URL(request.url ?? '/', 'http://mock').pathname;
      let reply: MockReply;
      if (request.method === 'POST' && path === JEV_PATH) {
        reply = typeof jevReply === 'function' ? jevReply(parseJson(Buffer.concat(chunks).toString('utf8'))) : jevReply;
      } else if (request.method === 'GET' && path === FORECAST_PATH) {
        reply = forecastReply;
      } else if (request.method === 'GET' && path === GEOCODE_PATH) {
        reply = geocodeReply;
      } else {
        sendJson(response, 404, { error: 'not_found' });
        return;
      }
      callCounts.set(path, (callCounts.get(path) ?? 0) + 1);
      if ('hang' in reply) return;
      sendJson(response, reply.status, reply.body);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      server.off('error', reject);
      resolve({
        jev(next) {
          jevReply = next;
        },
        forecast(next) {
          forecastReply = next;
        },
        geocode(next) {
          geocodeReply = next;
        },
        calls: (path) => callCounts.get(path) ?? 0,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            // Hung requests would otherwise keep `close()` waiting forever.
            server.closeAllConnections();
            server.close((error) => {
              if (error === undefined) resolveClose();
              else rejectClose(error);
            });
          }),
      });
    });
  });
}

function flagValue(argv: readonly string[], flag: string): number | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = Number(argv[index + 1]);
  if (!Number.isFinite(value)) throw new Error(`${flag} needs a number`);
  return value;
}

/**
 * `node integration/mockServices.ts --serve [--level <0..1>] [--temp <°C>]`: keeps the mock running
 * for a manual simulator check. Jev answers every question at `level` (default 1, so a composite
 * of `round(100 · level)`); the forecast is `MILD_FORECAST`, or a clear, dry day around `temp`;
 * geocoding finds Madrid. Stop it with Ctrl-C.
 */
async function serveFromCli(argv: readonly string[]): Promise<void> {
  const level = flagValue(argv, '--level') ?? 1;
  const temp = flagValue(argv, '--temp');
  if (level < 0 || level > 1) throw new Error('--level must be between 0 and 1');
  const mock = await startMockServices();
  mock.jev((body) => ({ status: 200, body: jevAnswers(body, level) }));
  if (temp !== undefined) {
    mock.forecast({
      status: 200,
      body: {
        current: { temperature_2m: temp, weather_code: 0 },
        daily: { temperature_2m_max: [temp + 3], temperature_2m_min: [temp - 3], precipitation_probability_max: [0] },
      },
    });
  }
  console.log(`mock Jev and Open-Meteo on :54498 (level ${String(level)}${temp === undefined ? '' : `, ${String(temp)} °C`})`);
  process.once('SIGINT', () => {
    void mock.close().then(() => {
      console.log(`served ${String(mock.calls(JEV_PATH))} Jev call(s)`);
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--serve')) {
  serveFromCli(process.argv).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
