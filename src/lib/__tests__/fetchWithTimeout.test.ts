import { REQUEST_TIMEOUT_MS, fetchWithTimeout } from '../fetchWithTimeout';

const originalFetch = globalThis.fetch;
const fetchMock = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit | undefined]>();

/** A request that never answers on its own: like `fetch`, it only settles when its signal aborts. */
function hangingRequest(_input: RequestInfo | URL, init: RequestInit | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const abort = (): void => {
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    };
    if (init?.signal?.aborted === true) {
      abort();
      return;
    }
    init?.signal?.addEventListener('abort', abort);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  jest.useRealTimers();
  globalThis.fetch = originalFetch;
});

test('the timeout is about 12 seconds', () => {
  expect(REQUEST_TIMEOUT_MS).toBe(12_000);
});

test('aborts a request that has not answered after the timeout', async () => {
  fetchMock.mockImplementation(hangingRequest);

  const request = fetchWithTimeout('http://127.0.0.1:54421/rest/v1/profiles', { method: 'GET' });
  const outcome = request.then(
    () => 'resolved',
    (error: unknown) => (error instanceof Error ? error.name : 'unknown'),
  );

  jest.advanceTimersByTime(REQUEST_TIMEOUT_MS - 1);
  await Promise.resolve();
  expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);

  jest.advanceTimersByTime(1);
  expect(await outcome).toBe('AbortError');
});

test('passes the request through and leaves no timer behind when it answers in time', async () => {
  const response = { ok: true } as Response;
  fetchMock.mockResolvedValue(response);

  await expect(fetchWithTimeout('http://x/', { method: 'POST', body: '{}' })).resolves.toBe(response);

  expect(fetchMock).toHaveBeenCalledWith('http://x/', expect.objectContaining({ method: 'POST', body: '{}' }));
  expect(jest.getTimerCount()).toBe(0);
});

test("a caller's own abort still cancels the request", async () => {
  fetchMock.mockImplementation(hangingRequest);
  const caller = new AbortController();

  const request = fetchWithTimeout('http://x/', { signal: caller.signal });
  caller.abort();

  await expect(request).rejects.toMatchObject({ name: 'AbortError' });
});

test('a signal that is already aborted cancels at once', async () => {
  fetchMock.mockImplementation(hangingRequest);
  const caller = new AbortController();
  caller.abort();

  await expect(fetchWithTimeout('http://x/', { signal: caller.signal })).rejects.toMatchObject({ name: 'AbortError' });
});
