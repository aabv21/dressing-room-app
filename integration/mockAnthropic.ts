// Mock Anthropic Messages API for the local `extract-attributes`. It listens on every interface since the Edge
// Runtime calls from a container (docs/local-stack.md#mock-claude).

import { readFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';

/** What the next `/v1/messages` calls get: a status and JSON body (after `delayMs`, if given), or no answer. */
export type MockReply = { status: number; body: unknown; delayMs?: number } | { hang: true };

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
      const current = reply;
      if ('hang' in current) return;
      if (current.delayMs === undefined) {
        sendJson(response, current.status, current.body);
        return;
      }
      setTimeout(() => {
        sendJson(response, current.status, current.body);
      }, current.delayMs);
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

/** `node integration/mockAnthropic.ts --serve <fixture>`: answers every call with `claude-<fixture>.json` until Ctrl-C. */
async function serveFromCli(argv: readonly string[]): Promise<void> {
  const fixture = argv[argv.indexOf('--serve') + 1];
  if (fixture === undefined || !/^[a-z-]+$/.test(fixture)) {
    throw new Error('usage: node integration/mockAnthropic.ts --serve <fixture>');
  }
  const url = new URL(`../supabase/functions/_shared/__tests__/fixtures/claude-${fixture}.json`, import.meta.url);
  // The name is checked above and resolved inside the repo's fixtures folder.
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
