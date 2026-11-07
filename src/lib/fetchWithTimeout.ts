/**
 * How long any Supabase request may take before it is abandoned. Without a limit a captive portal
 * or a dead connection holds a request open for the platform's own timeout (about a minute), with
 * the splash screen or a spinner up the whole time; aborted requests surface as network errors.
 */
export const REQUEST_TIMEOUT_MS = 12_000;

/**
 * `fetch` with an AbortController deadline, for supabase-js's `global.fetch`. A caller's own signal
 * still cancels the request. (Not `AbortSignal.timeout`/`AbortSignal.any`, which React Native's
 * runtime does not reliably provide.)
 */
export function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const callerSignal = init.signal;
  if (callerSignal !== undefined && callerSignal !== null) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener(
        'abort',
        () => {
          controller.abort();
        },
        { once: true },
      );
    }
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
  });
}
