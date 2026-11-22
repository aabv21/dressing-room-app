// `buy-check`'s call (docs/api.md#buy-check): the photo as a WebP, the answer checked with
// `isBuyCheckResponse`, errors mapped like the outfit functions' (`AiError`).
import type { SupabaseClient } from '@supabase/supabase-js';

import { isRecord } from '../../supabase/functions/_shared/guards.ts';
import type { BuyCheckResponse } from '../../supabase/functions/buy-check/handler.ts';
import { GARMENT_CATEGORIES, GARMENT_COLORS } from '../closet/catalog';
import type { Locale } from '../i18n';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { type AiOutcome, invoke } from '../outfits/aiClient';

export type { BuyCheckResponse, Verdict } from '../../supabase/functions/buy-check/handler.ts';

type Client = SupabaseClient<Database>;

const VERDICTS: readonly unknown[] = ['buy', 'think', 'skip'];
const MAX_DUPLICATES = 3;

/** What the screen renders of the item: its category and colors, from the catalog. */
function isItem(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.category === null || GARMENT_CATEGORIES.some((category) => category === value.category)) &&
    Array.isArray(value.colors) &&
    value.colors.every((color: unknown) => GARMENT_COLORS.some((known) => known === color))
  );
}

/** An answer this app version can render. */
export function isBuyCheckResponse(value: unknown): value is BuyCheckResponse {
  if (!isRecord(value)) return false;
  if (value.kind === 'not_garment') return true;
  return (
    value.kind === 'ok' &&
    isItem(value.item) &&
    Array.isArray(value.duplicates) &&
    value.duplicates.length <= MAX_DUPLICATES &&
    value.duplicates.every((duplicate: unknown) => isRecord(duplicate) && typeof duplicate.id === 'string') &&
    typeof value.newOutfits === 'number' &&
    Number.isInteger(value.newOutfits) &&
    value.newOutfits >= 0 &&
    VERDICTS.includes(value.verdict)
  );
}

export type BuyCheckInput = { image: string; date: string; language: Locale };

/** `image` is `prepareCheckPhoto`'s base64 WebP; `date` the local day the quota counts on. */
export function checkPurchase(input: BuyCheckInput, client: Client = supabase): Promise<AiOutcome<BuyCheckResponse>> {
  return invoke(
    'buy-check',
    { image: input.image, mediaType: 'image/webp', date: input.date, language: input.language },
    isBuyCheckResponse,
    client,
  );
}
