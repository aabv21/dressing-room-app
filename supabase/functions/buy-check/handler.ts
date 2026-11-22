// "Should I buy it?": Claude reads a photographed item, code compares it with the closet
// (docs/ai.md#should-i-buy-it). The photo is never stored or cached; logs carry only outcome words.

import { compareWithCloset, type Comparison, type Verdict } from '../_shared/buyCheck.ts';
import type { ClaudeEnv, SupabaseEnv } from '../_shared/env.ts';
import {
  buildExtractionRequest,
  EXTRACTION_CLAUDE_TIMEOUT_MS,
  EXTRACTION_MEDIA_TYPES,
  type ExtractionMediaType,
  type GarmentAttributes,
  parseExtraction,
} from '../_shared/extraction.ts';
import { isRecord } from '../_shared/guards.ts';
import { callerOf, readJson, reply } from '../_shared/http.ts';
import { consumeQuota, isIsoDate, loadGarments, loadProfile, runClaude } from '../_shared/userContext.ts';

export type BuyCheckEnv = SupabaseEnv & ClaudeEnv;

export type BuyCheckDeps = { env: BuyCheckEnv; fetch: typeof fetch };

export type { Verdict };

export type BuyCheckResponse = { kind: 'not_garment' } | ({ kind: 'ok'; item: GarmentAttributes } & Comparison);

export const BUY_CHECK_DAILY_LIMIT = 5;
/** Decoded bytes; the app sends a 784 px photo of a few hundred KB, so this only stops abuse. */
export const MAX_IMAGE_BYTES = 1_500_000;
const LANGUAGES = ['en', 'es'] as const;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

type Input = { image: string; mediaType: ExtractionMediaType; date: string };

/** The decoded size of well-formed base64, or null when it isn't. */
function decodedSize(image: string): number | null {
  if (image.length === 0 || image.length % 4 !== 0 || !BASE64.test(image)) return null;
  const padding = image.endsWith('==') ? 2 : image.endsWith('=') ? 1 : 0;
  return (image.length / 4) * 3 - padding;
}

/** Whether the first bytes are the declared format's: a JPEG's SOI marker or a WebP's RIFF…WEBP header. */
function signatureMatches(image: string, mediaType: ExtractionMediaType): boolean {
  const head = Uint8Array.from(atob(image.slice(0, 16)), (char) => char.charCodeAt(0));
  const text = (from: number, to: number): string => String.fromCharCode(...head.subarray(from, to));
  if (mediaType === 'image/jpeg') return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  return text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP';
}

/** `too_large` for an image over `MAX_IMAGE_BYTES`, null when malformed. `language` is checked but unused: the answer has no text. */
async function readInput(request: Request): Promise<Input | 'too_large' | null> {
  const body = await readJson(request);
  if (!isRecord(body)) return null;
  const { image, mediaType, date, language } = body;
  const knownType = EXTRACTION_MEDIA_TYPES.find((candidate) => candidate === mediaType);
  if (typeof image !== 'string' || knownType === undefined || !isIsoDate(date)) return null;
  if (!LANGUAGES.some((candidate) => candidate === language)) return null;
  // Checked on the length first, so an oversized body is refused before the regex walks it.
  if (Math.floor(image.length / 4) * 3 - 2 > MAX_IMAGE_BYTES) return 'too_large';
  const size = decodedSize(image);
  if (size === null || size < 12 || !signatureMatches(image, knownType)) return null;
  if (size > MAX_IMAGE_BYTES) return 'too_large';
  return { image, mediaType: knownType, date };
}

export async function handleBuyCheck(request: Request, deps: BuyCheckDeps): Promise<Response> {
  if (request.method !== 'POST') return reply('invalid', 405, { error: 'method_not_allowed' });
  const caller = callerOf(request);
  if (caller === null) return reply('invalid', 401, { error: 'unauthorized' });
  const { auth, userId } = caller;
  const input = await readInput(request);
  if (input === null) return reply('invalid', 400, { error: 'invalid_input' });
  if (input === 'too_large') return reply('too_large', 413, { error: 'image_too_large' });

  const { env, fetch: fetchFn } = deps;
  try {
    // Read first, so a database failure answers 500 without spending the quota.
    const [garments, profile] = await Promise.all([loadGarments(env, fetchFn, auth), loadProfile(env, fetchFn, auth)]);
    if (!(await consumeQuota(env, fetchFn, userId, 'buy_check', BUY_CHECK_DAILY_LIMIT, input.date))) {
      return reply('over_quota', 429, { error: 'over_quota' });
    }

    const clothingType = profile?.clothing_type ?? 'everything';
    const extraction = buildExtractionRequest(input.image, clothingType, input.mediaType);
    const answer = await runClaude(env, fetchFn, extraction, EXTRACTION_CLAUDE_TIMEOUT_MS);
    if (answer === null) return reply('unavailable', 503, { error: 'analysis_unavailable' });
    const parsed = parseExtraction(answer, clothingType);
    if (parsed.kind === 'failed') {
      if (parsed.reason === 'not_garment') return reply('not_garment', 200, { kind: 'not_garment' } satisfies BuyCheckResponse);
      return reply('unreadable', 503, { error: 'analysis_unavailable' });
    }

    const comparison = compareWithCloset(parsed.attributes, garments);
    const result: BuyCheckResponse = { kind: 'ok', item: parsed.attributes, ...comparison };
    return reply('checked', 200, result, { verdict: comparison.verdict });
  } catch {
    // The closet, profile or quota read failed; Claude wasn't called after a failed quota.
    return reply('error', 500, { error: 'internal' });
  }
}
