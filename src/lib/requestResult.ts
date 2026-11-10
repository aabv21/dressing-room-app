/**
 * The outcome of a write the UI reports back to the user: success, or one of three translated
 * failure kinds. Repositories map `error` onto their own message keys (e.g. `profile.error.*`).
 */
export type RequestError = 'network' | 'invalid' | 'unknown';
export type RequestResult = { ok: true } | { ok: false; error: RequestError };

type ErrorWithCode = { code?: string };

/** The `{ error, status, data }` shape a PostgREST builder resolves to. */
export type RequestOutcome = { error: ErrorWithCode | null; status: number; data?: unknown };

/**
 * Postgres error classes that mean "the values were rejected" rather than "the request failed":
 * 23514 check_violation (the CHECK ranges), 23502 not_null_violation, 22P02 invalid enum/number
 * text, 22003 numeric out of range, 22001 string too long.
 */
const INVALID_VALUE_CODES: ReadonlySet<string> = new Set(['23514', '23502', '22P02', '22003', '22001']);

export function toRequestError(error: ErrorWithCode, status: number): RequestError {
  // postgrest-js reports a rejected `fetch` (offline, DNS, timeout) as status 0 with an empty code.
  if (status === 0) {
    return 'network';
  }
  if (error.code !== undefined && INVALID_VALUE_CODES.has(error.code)) {
    return 'invalid';
  }
  return 'unknown';
}

export async function runRequest(
  request: () => PromiseLike<RequestOutcome>,
  /** Whether a successful response actually did the work (e.g. an update reached a row). */
  applied: (response: RequestOutcome) => boolean = () => true,
): Promise<RequestResult> {
  try {
    const response = await request();
    if (response.error !== null) {
      return { ok: false, error: toRequestError(response.error, response.status) };
    }
    return applied(response) ? { ok: true } : { ok: false, error: 'unknown' };
  } catch (error) {
    return { ok: false, error: error instanceof TypeError ? 'network' : 'unknown' };
  }
}
