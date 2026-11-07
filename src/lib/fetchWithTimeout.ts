/**
 * How long any Supabase request may take before it is abandoned. Without a limit a captive portal
 * or a dead connection holds a request open for the platform's own timeout (about a minute), with
 * the splash screen or a spinner up the whole time; aborted requests surface as network errors.
 *
 * NOTE: the deadline covers the whole request, including sending its body, so it also caps
 * uploads: a 2 MiB garment photo over a slow link can need more than 12 s. Upgrade path: give
 * storage uploads their own, longer per-request deadline when uploads arrive.
 */
export const REQUEST_TIMEOUT_MS = 12_000;

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
  const timer = setTimeout(abort, REQUEST_TIMEOUT_MS);
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
