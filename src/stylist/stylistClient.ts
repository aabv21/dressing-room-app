// `stylist`'s call (docs/api.md#stylist): the last turns that fit its limits, the answer checked with
// `isStylistResponse`, errors mapped like the outfit functions' (`AiError`).
import type { SupabaseClient } from '@supabase/supabase-js';

import { isRecord, UUID } from '../../supabase/functions/_shared/guards.ts';
import { MAX_TURNS, TOTAL_MAX_CHARS, TURN_MAX_CHARS, type Turn } from '../../supabase/functions/_shared/stylist.ts';
import type { StylistResponse } from '../../supabase/functions/stylist/handler.ts';
import { MAX_OUTFIT_PIECES } from '../closet/catalog';
import type { Locale } from '../i18n';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { type AiOutcome, invoke } from '../outfits/aiClient';

export type { StylistResponse } from '../../supabase/functions/stylist/handler.ts';
export { TURN_MAX_CHARS };
export type ChatTurn = Turn;

type Client = SupabaseClient<Database>;

const length = (text: string): number => Array.from(text).length;

function isOutfit(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value) || !Array.isArray(value.garment_ids)) return false;
  const ids = value.garment_ids as unknown[];
  return ids.length > 0 && ids.length <= MAX_OUTFIT_PIECES && ids.every((id) => typeof id === 'string' && UUID.test(id));
}

/** An answer this app version can render. */
export function isStylistResponse(value: unknown): value is StylistResponse {
  return (
    isRecord(value) &&
    value.kind === 'ok' &&
    typeof value.reply === 'string' &&
    value.reply.length > 0 &&
    length(value.reply) <= TURN_MAX_CHARS &&
    isOutfit(value.outfit)
  );
}

/** The newest turns within the function's limits (12 turns, 4,000 characters), starting with the user's. */
export function historyForRequest(chat: readonly ChatTurn[]): ChatTurn[] {
  const kept: ChatTurn[] = [];
  let total = 0;
  for (let index = chat.length - 1; index >= 0 && kept.length < MAX_TURNS; index -= 1) {
    const turn = chat.at(index);
    if (turn === undefined) break;
    total += length(turn.text);
    if (total > TOTAL_MAX_CHARS) break;
    kept.unshift({ role: turn.role, text: turn.text });
  }
  while (kept[0]?.role === 'assistant') kept.shift();
  return kept;
}

export type StylistInput = { messages: readonly ChatTurn[]; date: string; language: Locale };

/** `date` is the local day the quota counts on; `language` the reply's. */
export function askStylist(input: StylistInput, client: Client = supabase): Promise<AiOutcome<StylistResponse>> {
  return invoke('stylist', { messages: input.messages, date: input.date, language: input.language }, isStylistResponse, client);
}
