/**
 * How long any Supabase request may take before it is abandoned. Without a limit a captive portal
 * or a dead connection holds a request open for the platform's own timeout (about a minute), with
 * the splash screen or a spinner up the whole time; aborted requests surface as network errors.
 */
export const REQUEST_TIMEOUT_MS = 12_000;

/**
 * The deadline covers the whole request, including sending its body, so storage uploads (a `POST`
 * or `PUT` to a URL containing `/storage/v1/object/`) get longer: a 2 MiB garment photo over a slow
 * link can need more than 12 s.
 */
export const UPLOAD_TIMEOUT_MS = 60_000;

const STORAGE_OBJECT_PATH = '/storage/v1/object/';

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function deadlineFor(input: RequestInfo | URL, init: RequestInit): number {
  const method = (init.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
  const upload = (method === 'POST' || method === 'PUT') && urlOf(input).includes(STORAGE_OBJECT_PATH);
  return upload ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
}

/**
 * `fetch` with an AbortController deadline, for supabase-js's `global.fetch`. A caller's own signal
 * still cancels the request, and is no longer listened to once the request settles. (Not
 * `AbortSignal.timeout`/`AbortSignal.any`, which React Native's runtime does not reliably provide.)
 */
export function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const abort = (): void => {
    controller.abort();
  };
  const timer = setTimeout(abort, deadlineFor(input, init));
  const callerSignal = init.signal ?? undefined;
  if (callerSignal?.aborted === true) {
    abort();
  } else {
    callerSignal?.addEventListener('abort', abort, { once: true });
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', abort);
  });
}
