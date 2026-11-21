/**
 * Without it a captive portal or dead connection holds a request (and a spinner) for the platform's
 * own ~1 min timeout; an aborted request surfaces as a network error.
 */
export const REQUEST_TIMEOUT_MS = 12_000;

/**
 * The deadline includes sending the body, and a 2 MiB photo over a slow link can need over 12 s.
 * Signing (`/object/sign/`) and listing (`/object/list/`) send no photo, so they keep 12 s.
 */
export const UPLOAD_TIMEOUT_MS = 60_000;

/**
 * `rate-outfit` and `lucky-list` can take ~40 s when all is slow (weather 10 s + Jev 10 s + the Claude
 * fallback 20 s; `_shared/userContext.ts`, `rate-outfit/handler.ts`'s `SWAP_BUDGET_MS`).
 */
export const FUNCTION_TIMEOUT_MS = 45_000;

const STORAGE_OBJECT_PATH = '/storage/v1/object/';
const NOT_UPLOADS = ['/storage/v1/object/sign/', '/storage/v1/object/list/'];
const FUNCTIONS_PATH = '/functions/v1/';

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function deadlineFor(input: RequestInfo | URL, init: RequestInit): number {
  const method = (init.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
  const url = urlOf(input);
  if (method === 'POST' || method === 'PUT') {
    if (url.includes(STORAGE_OBJECT_PATH) && !NOT_UPLOADS.some((path) => url.includes(path))) {
      return UPLOAD_TIMEOUT_MS;
    }
    if (method === 'POST' && url.includes(FUNCTIONS_PATH)) {
      return FUNCTION_TIMEOUT_MS;
    }
  }
  return REQUEST_TIMEOUT_MS;
}

/**
 * A caller's own signal still cancels, and is unsubscribed once the request settles. Not
 * `AbortSignal.timeout`/`.any`, which React Native doesn't reliably provide.
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
