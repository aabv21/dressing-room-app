// The `extract-attributes` Edge Function's request handler: called by a database webhook after a
// garment row is inserted, it sends the garment's photo to Claude and writes the enum-only
// attributes back. The photo is read through `_shared/photoStore.ts`. Runtime-neutral: every effect
// goes through the injected `fetch`, so Jest drives it under Node and `index.ts` serves it under Deno.
//
// Every failure after the garment is loaded (quota check, photo, Claude, parsing) still ends the
// garment's `pending` state, so it always reaches review. Logs carry only the garment id and an
// outcome word, never the photo, the prompt or the model's output.

import { CLOTHING_TYPES, type ClothingType } from '../_shared/catalog.ts';
import { buildExtractionRequest, isRecord, parseExtraction } from '../_shared/extraction.ts';
import { downloadObject, photoPath } from '../_shared/photoStore.ts';

export type ExtractEnv = {
  supabaseUrl: string;
  serviceRoleKey: string;
  webhookSecret: string;
  anthropicApiKey: string;
  anthropicBaseUrl: string;
};

export type ExtractDeps = { env: ExtractEnv; fetch: typeof fetch };

export type ExtractOutcome = 'done' | 'failed' | 'over_quota' | 'skipped';

export const CLAUDE_TIMEOUT_MS = 30_000;
export const EXTRACTION_DAILY_LIMIT = 100;
const ANTHROPIC_VERSION = '2023-06-01';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Garment = { id: string; userId: string; extractionStatus: string };
type WriteBack = { outcome: Exclude<ExtractOutcome, 'skipped'>; patch: Record<string, unknown> };

const FAILED: WriteBack = { outcome: 'failed', patch: { extraction_status: 'failed' } };

class UpstreamError extends Error {}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function log(garmentId: string, outcome: ExtractOutcome | 'error'): void {
  console.info(JSON.stringify({ garment_id: garmentId, outcome }));
}

const encoder = new TextEncoder();

/** Compares in time that depends only on the expected secret's length. */
function secretMatches(given: string | null, expected: string): boolean {
  if (given === null || expected === '') return false;
  const a = encoder.encode(given);
  const b = encoder.encode(expected);
  let difference = a.length ^ b.length;
  b.forEach((byte, index) => {
    difference |= byte ^ (a.at(index) ?? 0);
  });
  return difference === 0;
}

async function readGarmentId(request: Request): Promise<string | null> {
  try {
    const body: unknown = await request.json();
    if (!isRecord(body) || typeof body.garment_id !== 'string' || !UUID.test(body.garment_id)) return null;
    return body.garment_id.toLowerCase();
  } catch {
    return null;
  }
}

// Base64 of every 3-byte-aligned chunk concatenates into the base64 of the whole buffer; chunking
// keeps `String.fromCharCode(...)` under the engine's argument limit.
const BASE64_CHUNK = 3 * 8192;

function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
    parts.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK))));
  }
  return parts.join('');
}

function serviceRequest(deps: ExtractDeps, path: string, init: RequestInit = {}): Promise<Response> {
  const { serviceRoleKey, supabaseUrl } = deps.env;
  return deps.fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init.method === 'PATCH' ? { prefer: 'return=minimal' } : {}),
    },
  });
}

async function serviceJson(deps: ExtractDeps, path: string, init?: RequestInit): Promise<unknown> {
  const response = await serviceRequest(deps, path, init);
  if (!response.ok) throw new UpstreamError(`HTTP ${String(response.status)}`);
  return (await response.json()) as unknown;
}

async function loadGarment(deps: ExtractDeps, garmentId: string): Promise<Garment | null> {
  const rows = await serviceJson(deps, `/rest/v1/garments?id=eq.${garmentId}&select=id,user_id,extraction_status`);
  if (!Array.isArray(rows)) throw new UpstreamError('garments: not an array');
  const [row] = rows as unknown[];
  if (row === undefined) return null;
  if (
    !isRecord(row) ||
    typeof row.user_id !== 'string' ||
    !UUID.test(row.user_id) ||
    typeof row.extraction_status !== 'string'
  ) {
    throw new UpstreamError('garments: unexpected row');
  }
  return { id: garmentId, userId: row.user_id, extractionStatus: row.extraction_status };
}

async function consumeQuota(deps: ExtractDeps, userId: string): Promise<boolean> {
  const allowed = await serviceJson(deps, '/rest/v1/rpc/consume_quota', {
    method: 'POST',
    body: JSON.stringify({ p_user_id: userId, p_kind: 'extraction', p_limit: EXTRACTION_DAILY_LIMIT }),
  });
  return allowed === true;
}

async function loadClothingType(deps: ExtractDeps, userId: string): Promise<ClothingType> {
  const rows = await serviceJson(deps, `/rest/v1/profiles?user_id=eq.${userId}&select=clothing_type`);
  const [row] = Array.isArray(rows) ? (rows as unknown[]) : [];
  const clothingType = isRecord(row) ? row.clothing_type : null;
  return CLOTHING_TYPES.find((candidate) => candidate === clothingType) ?? 'everything';
}

async function loadPhotoBase64(deps: ExtractDeps, garment: Garment): Promise<string | null> {
  const bytes = await downloadObject(deps.env, deps.fetch, photoPath(garment.userId, garment.id, 'full'));
  return bytes === null ? null : toBase64(bytes);
}

/** The Messages API response body, or null on a non-2xx answer, a network error or the timeout. */
async function askClaude(deps: ExtractDeps, payload: Record<string, unknown>): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, CLAUDE_TIMEOUT_MS);
  try {
    const response = await deps.fetch(`${deps.env.anthropicBaseUrl.replace(/\/+$/, '')}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': deps.env.anthropicApiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function extract(deps: ExtractDeps, garment: Garment): Promise<WriteBack> {
  try {
    if (!(await consumeQuota(deps, garment.userId))) {
      return { outcome: 'over_quota', patch: { extraction_status: 'over_quota' } };
    }
    const clothingType = await loadClothingType(deps, garment.userId);
    const photo = await loadPhotoBase64(deps, garment);
    if (photo === null) return FAILED;
    const body = await askClaude(deps, buildExtractionRequest(photo, clothingType));
    if (body === null) return FAILED;
    const parsed = parseExtraction(body, clothingType);
    if (parsed.kind === 'failed') return FAILED;
    return {
      outcome: 'done',
      patch: { ...parsed.attributes, uncertain_fields: parsed.uncertainFields, extraction_status: 'done' },
    };
  } catch {
    return FAILED;
  }
}

async function writeBack(deps: ExtractDeps, garmentId: string, patch: Record<string, unknown>): Promise<void> {
  // The `pending` filter makes a duplicate webhook delivery a no-op instead of a second write.
  const response = await serviceRequest(deps, `/rest/v1/garments?id=eq.${garmentId}&extraction_status=eq.pending`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new UpstreamError(`PATCH HTTP ${String(response.status)}`);
}

export async function handleExtract(request: Request, deps: ExtractDeps): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!secretMatches(request.headers.get('x-webhook-secret'), deps.env.webhookSecret)) {
    return json(401, { error: 'unauthorized' });
  }
  const garmentId = await readGarmentId(request);
  if (garmentId === null) return json(400, { error: 'invalid_body' });

  let outcome: ExtractOutcome;
  try {
    const garment = await loadGarment(deps, garmentId);
    if (garment?.extractionStatus !== 'pending') {
      outcome = 'skipped';
    } else {
      const result = await extract(deps, garment);
      await writeBack(deps, garmentId, result.patch);
      outcome = result.outcome;
    }
  } catch {
    // The database itself failed (loading or writing back). The garment may stay `pending`; the app
    // treats a garment pending for 10 minutes as failed, so it still reaches review.
    log(garmentId, 'error');
    return json(500, { error: 'internal' });
  }

  log(garmentId, outcome);
  return json(200, { outcome });
}
