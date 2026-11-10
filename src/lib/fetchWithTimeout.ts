/**
 * How long any Supabase request may take before it is abandoned. Without a limit a captive portal
 * or a dead connection holds a request open for the platform's own timeout (about a minute), with
 * the splash screen or a spinner up the whole time; aborted requests surface as network errors.
 */
export const REQUEST_TIMEOUT_MS = 12_000;

/**
 * The deadline covers the whole request, including sending its body, so storage uploads (a `POST`
 * or `PUT` to a URL containing `/storage/v1/object/`) get longer: a 2 MiB garment photo over a slow
 * link can need more than 12 s. Signing URLs (`/object/sign/`) and listing (`/object/list/`) are
 * also `POST`s there but send no photo, so they keep 12 s.
 */
export const UPLOAD_TIMEOUT_MS = 60_000;

/**
 * `rate-outfit` and `lucky-list` can take up to ~40 s in the rare all-slow case (weather 10 s +
 * Jev 10 s + the Claude fallback 20 s; see `supabase/functions/_shared/userContext.ts` and
 * `rate-outfit/handler.ts`'s `SWAP_BUDGET_MS`), so a `POST` to `/functions/v1/` (supabase-js's
 * `functions.invoke`) gets longer than the default 12 s.
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
