/** @jest-environment node */
// supabase/functions/_shared/__tests__/http.test.ts
import { callerOf, fetchWithDeadline, readJson, reply } from '../http.ts';

const { jest } = import.meta;

const USER_ID = '8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const token = (claims: unknown): string =>
  `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

/** A fetch that never answers; its call ends only when the caller aborts it. */
const hanging = ((_url: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    });
  })) as typeof fetch;

afterEach(() => {
  jest.useRealTimers();
});

describe('fetchWithDeadline', () => {
  test('rejects with an abort once `ms` passes when the fetch never settles', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    let settled = false;
    const pending = fetchWithDeadline(hanging, 'http://slow.test/', {}, 1_000).finally(() => {
      settled = true;
    });
    const outcome = pending.then(
      () => 'resolved',
      // Under Jest's VM context, a DOMException isn't `instanceof` the test's own `Error`.
      (error: unknown) => (typeof error === 'object' && error !== null && 'name' in error ? error.name : 'other'),
    );
    await jest.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(await outcome).toBe('AbortError');
  });

  test('the deadline covers reading the body too', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    // Headers arrive, then the body stalls; like the web fetch, the abort errors the body stream.
    const stalled = ((_url: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start: (stream) => {
              init?.signal?.addEventListener('abort', () => {
                stream.error(new DOMException('The operation was aborted.', 'AbortError'));
              });
            },
          }),
        ),
      )) as typeof fetch;
    const outcome = fetchWithDeadline(stalled, 'http://slow.test/', {}, 1_000).then(
      () => 'resolved',
      () => 'rejected',
    );
    await jest.advanceTimersByTimeAsync(1_000);
    expect(await outcome).toBe('rejected');
  });

  test('answers the response, status and body intact, with the abort signal passed to fetch', async () => {
    let signal: AbortSignal | null | undefined;
    const ok = ((_url: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal;
      return Promise.resolve(new Response('{"a":1}', { status: 201, headers: { 'content-type': 'application/json' } }));
    }) as typeof fetch;

    const response = await fetchWithDeadline(ok, 'http://fast.test/', { method: 'POST' }, 1_000);

    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({ a: 1 });
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  test('passes a body-less answer through', async () => {
    const empty = (() => Promise.resolve(new Response(null, { status: 204 }))) as typeof fetch;
    expect((await fetchWithDeadline(empty, 'http://fast.test/', {}, 1_000)).status).toBe(204);
  });
});

describe('callerOf', () => {
  const request = (auth?: string): Request =>
    new Request('http://functions.test/', { method: 'POST', headers: auth === undefined ? {} : { authorization: auth } });

  test('the bearer token and its user id', () => {
    const auth = `Bearer ${token({ sub: USER_ID.toUpperCase() })}`;
    expect(callerOf(request(auth))).toEqual({ auth, userId: USER_ID });
  });

  test.each([
    ['no header', undefined],
    ['a token without a sub (the anon key)', `Bearer ${token({ role: 'anon' })}`],
    ['garbage', 'Bearer nope'],
  ])('null for %s', (_label, auth) => {
    expect(callerOf(request(auth))).toBeNull();
  });
});

describe('readJson', () => {
  test('the parsed body, or null when it is not JSON', async () => {
    expect(await readJson(new Request('http://f.test/', { method: 'POST', body: '{"a":1}' }))).toEqual({ a: 1 });
    expect(await readJson(new Request('http://f.test/', { method: 'POST', body: '{"a":' }))).toBeNull();
  });
});

describe('reply', () => {
  test('answers JSON and logs only the outcome word (plus any extra words given)', async () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const response = reply('deleted', 200, { outcome: 'deleted' }, { revoke: 'skipped' });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json');
      expect(await response.json()).toEqual({ outcome: 'deleted' });
      expect(info.mock.calls).toEqual([[JSON.stringify({ outcome: 'deleted', revoke: 'skipped' })]]);
    } finally {
      info.mockRestore();
    }
  });
});
