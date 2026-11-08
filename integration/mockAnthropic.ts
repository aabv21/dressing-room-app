// integration/mockAnthropic.ts
//
// A stand-in for the Anthropic Messages API, so the local `extract-attributes` Edge Function can run
// end to end without a real key. The local Edge Runtime points `ANTHROPIC_BASE_URL` at
// `http://host.docker.internal:54499` (see `supabase/config.toml`), so this listens on every
// interface, not only loopback: the request comes from inside a container.

import { readFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';

/** What the next `/v1/messages` calls get: a status and JSON body, or no answer at all. */
export type MockReply = { status: number; body: unknown } | { hang: true };

export type MockAnthropic = {
  /** Sets the reply for every following call, until changed again. */
  respondWith(next: MockReply): void;
  /** How many `POST /v1/messages` calls have arrived so far. */
  calls(): number;
  close(): Promise<void>;
};

const DEFAULT_REPLY: MockReply = { status: 500, body: { type: 'error', error: { type: 'api_error', message: 'no reply set' } } };

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

export function startMockAnthropic(port = 54499): Promise<MockAnthropic> {
  let reply: MockReply = DEFAULT_REPLY;
  let callCount = 0;

  const server = createServer((request, response) => {
    // Drain the body (the base64 photo) so the client never blocks on a full socket buffer.
    request.resume();
    request.on('end', () => {
      if (request.method !== 'POST' || request.url !== '/v1/messages') {
        sendJson(response, 404, { type: 'error', error: { type: 'not_found_error', message: 'not found' } });
        return;
      }
      callCount += 1;
      if ('hang' in reply) return;
      sendJson(response, reply.status, reply.body);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      server.off('error', reject);
      resolve({
        respondWith(next) {
          reply = next;
        },
        calls: () => callCount,
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

/**
 * `node integration/mockAnthropic.ts --serve <fixture>`: keeps the mock running for a manual
 * simulator check, answering every call with `supabase/functions/_shared/__tests__/fixtures/
 * claude-<fixture>.json` (e.g. `ok`, `low-confidence`). Stop it with Ctrl-C.
 */
async function serveFromCli(argv: readonly string[]): Promise<void> {
  const fixture = argv[argv.indexOf('--serve') + 1];
  if (fixture === undefined || !/^[a-z-]+$/.test(fixture)) {
    throw new Error('usage: node integration/mockAnthropic.ts --serve <fixture>');
  }
  const url = new URL(`../supabase/functions/_shared/__tests__/fixtures/claude-${fixture}.json`, import.meta.url);
  // The name is checked above and resolved inside the repo's fixtures folder.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const body: unknown = JSON.parse(await readFile(url, 'utf8'));
  const mock = await startMockAnthropic();
  mock.respondWith({ status: 200, body });
  console.log(`mock Claude on :54499 answering with claude-${fixture}.json`);
  process.once('SIGINT', () => {
    void mock.close().then(() => {
      console.log(`served ${String(mock.calls())} call(s)`);
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--serve')) {
  serveFromCli(process.argv).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
