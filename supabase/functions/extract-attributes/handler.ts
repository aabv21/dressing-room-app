// Webhook after a garment insert: Claude reads the photo, enum attributes are written back. Any failure
// after loading still ends `pending`. Logs carry only the garment id and an outcome word.

import { CLOTHING_TYPES, type ClothingType } from '../_shared/catalog.ts';
import type { ClaudeEnv, ServiceEnv, WebhookEnv } from '../_shared/env.ts';
import { buildExtractionRequest, parseExtraction } from '../_shared/extraction.ts';
import { isRecord, UUID } from '../_shared/guards.ts';
import { json, readJson } from '../_shared/http.ts';
import { downloadObject, photoPath } from '../_shared/photoStore.ts';
import { consumeQuota, restJson, restRows, runClaude, serviceHeaders, UpstreamError } from '../_shared/userContext.ts';

export type ExtractEnv = ServiceEnv & ClaudeEnv & WebhookEnv;

export type ExtractDeps = { env: ExtractEnv; fetch: typeof fetch };

export type ExtractOutcome = 'done' | 'failed' | 'over_quota' | 'skipped';

/** Longer than the outfit functions' Claude calls: a photo request takes longer to answer. */
export const EXTRACTION_CLAUDE_TIMEOUT_MS = 30_000;
export const EXTRACTION_DAILY_LIMIT = 100;

/** `updatedAt` is the row's `updated_at` as PostgREST wrote it, matched exactly by the write-back. */
type Garment = { id: string; userId: string; extractionStatus: string; reviewed: boolean; updatedAt: string };
type WriteBack = { outcome: Exclude<ExtractOutcome, 'skipped'>; patch: Record<string, unknown> };

const FAILED: WriteBack = { outcome: 'failed', patch: { extraction_status: 'failed' } };

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
  const body = await readJson(request);
  if (!isRecord(body) || typeof body.garment_id !== 'string' || !UUID.test(body.garment_id)) return null;
  return body.garment_id.toLowerCase();
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

async function loadGarment(deps: ExtractDeps, garmentId: string): Promise<Garment | null> {
  const select = 'id,user_id,extraction_status,reviewed_at,updated_at';
  const url = `${deps.env.supabaseUrl}/rest/v1/garments?id=eq.${garmentId}&select=${select}`;
  const [row] = await restRows(deps.fetch, url, serviceHeaders(deps.env));
  if (row === undefined) return null;
  if (
    !isRecord(row) ||
    typeof row.user_id !== 'string' ||
    !UUID.test(row.user_id) ||
    typeof row.extraction_status !== 'string' ||
    (row.reviewed_at !== null && typeof row.reviewed_at !== 'string') ||
    typeof row.updated_at !== 'string'
  ) {
    throw new UpstreamError('garments: unexpected row');
  }
  return {
    id: garmentId,
    userId: row.user_id,
    extractionStatus: row.extraction_status,
    reviewed: row.reviewed_at !== null,
    updatedAt: row.updated_at,
  };
}

async function loadClothingType(deps: ExtractDeps, userId: string): Promise<ClothingType> {
  const rows = await restJson(deps.fetch, `${deps.env.supabaseUrl}/rest/v1/profiles?user_id=eq.${userId}&select=clothing_type`, {
    headers: serviceHeaders(deps.env),
  });
  const [row] = Array.isArray(rows) ? (rows as unknown[]) : [];
  const clothingType = isRecord(row) ? row.clothing_type : null;
  return CLOTHING_TYPES.find((candidate) => candidate === clothingType) ?? 'everything';
}

async function loadPhotoBase64(deps: ExtractDeps, garment: Garment): Promise<string | null> {
  const bytes = await downloadObject(deps.env, deps.fetch, photoPath(garment.userId, garment.id, 'full'));
  return bytes === null ? null : toBase64(bytes);
}

async function extract(deps: ExtractDeps, garment: Garment): Promise<WriteBack> {
  try {
    // No day: the database counts extraction on the UTC day.
    if (!(await consumeQuota(deps.env, deps.fetch, garment.userId, 'extraction', EXTRACTION_DAILY_LIMIT))) {
      return { outcome: 'over_quota', patch: { extraction_status: 'over_quota' } };
    }
    const clothingType = await loadClothingType(deps, garment.userId);
    const photo = await loadPhotoBase64(deps, garment);
    if (photo === null) return FAILED;
    const body = await runClaude(deps.env, deps.fetch, buildExtractionRequest(photo, clothingType), EXTRACTION_CLAUDE_TIMEOUT_MS);
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

/** Returns whether the guarded write matched the garment. */
async function writeBack(deps: ExtractDeps, garment: Garment, patch: Record<string, unknown>): Promise<boolean> {
  // `pending` makes a duplicate delivery a no-op; `reviewed_at` and `updated_at` (read before the
  // Claude call) keep a review or a detail edit saved meanwhile from being overwritten by the model.
  const filter = [
    `id=eq.${garment.id}`,
    'extraction_status=eq.pending',
    'reviewed_at=is.null',
    `updated_at=eq.${encodeURIComponent(garment.updatedAt)}`,
    'select=id',
  ].join('&');
  const rows = await restJson(deps.fetch, `${deps.env.supabaseUrl}/rest/v1/garments?${filter}`, {
    method: 'PATCH',
    headers: { ...serviceHeaders(deps.env), 'content-type': 'application/json', prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  if (!Array.isArray(rows)) throw new UpstreamError('PATCH: not an array');
  return rows.length > 0;
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
    if (garment?.extractionStatus !== 'pending' || garment.reviewed) {
      outcome = 'skipped';
    } else {
      const result = await extract(deps, garment);
      outcome = (await writeBack(deps, garment, result.patch)) ? result.outcome : 'skipped';
    }
  } catch {
    // The database failed; a garment left `pending` reaches review after the app's 10-minute timeout.
    log(garmentId, 'error');
    return json(500, { error: 'internal' });
  }

  log(garmentId, outcome);
  return json(200, { outcome });
}
