// "Ask your stylist": a chat with Claude about the caller's own closet, with server-side tools
// (docs/ai.md#ask-your-stylist). Nothing is stored or cached; logs carry only outcome words.

import type { ClaudeEnv, SupabaseEnv, WeatherEnv } from '../_shared/env.ts';
import { isRecord } from '../_shared/guards.ts';
import { callerOf, readJson, reply } from '../_shared/http.ts';
import type { Language } from '../_shared/searchTerms.ts';
import {
  buildStylistRequest,
  MAX_TOOL_ROUNDS,
  ownOutfit,
  parseStep,
  parseTurns,
  runTool,
  sanitizeReply,
  type ToolEnv,
  type Turn,
} from '../_shared/stylist.ts';
import { consumeQuota, getLocalWeather, isIsoDate, loadGarments, loadProfile, runClaude } from '../_shared/userContext.ts';

export type StylistEnv = SupabaseEnv & ClaudeEnv & WeatherEnv;

export type StylistDeps = { env: StylistEnv; fetch: typeof fetch; now?: () => number };

export type StylistResponse = { kind: 'ok'; reply: string; outfit?: { garment_ids: string[] } };

export const STYLIST_DAILY_LIMIT = 20;
/** From the request's arrival; the app waits 45 s (`FUNCTION_TIMEOUT_MS`), so this leaves room for the reads and the reply. */
export const STYLIST_DEADLINE_MS = 25_000;
/** No model call starts with less than this left: it couldn't finish anyway. */
export const MIN_CALL_MS = 3_000;
const LANGUAGES = ['en', 'es'] as const;

type Input = { turns: Turn[]; date: string; language: Language };

async function readInput(request: Request): Promise<Input | null> {
  const body = await readJson(request);
  if (!isRecord(body)) return null;
  const turns = parseTurns(body.messages);
  const language = LANGUAGES.find((candidate) => candidate === body.language);
  if (turns === null || language === undefined || !isIsoDate(body.date)) return null;
  return { turns, date: body.date, language };
}

export async function handleStylist(request: Request, deps: StylistDeps): Promise<Response> {
  const now = deps.now ?? Date.now;
  const deadline = now() + STYLIST_DEADLINE_MS;
  if (request.method !== 'POST') return reply('invalid', 405, { error: 'method_not_allowed' });
  const caller = callerOf(request);
  if (caller === null) return reply('invalid', 401, { error: 'unauthorized' });
  const { auth, userId } = caller;
  const input = await readInput(request);
  if (input === null) return reply('invalid', 400, { error: 'invalid_input' });

  const { env, fetch: fetchFn } = deps;
  let garments: Awaited<ReturnType<typeof loadGarments>>;
  let profile: Awaited<ReturnType<typeof loadProfile>>;
  try {
    // Only the caller's rows, read with their token: no prompt can reach anyone else's.
    [garments, profile] = await Promise.all([loadGarments(env, fetchFn, auth), loadProfile(env, fetchFn, auth)]);
    if (!(await consumeQuota(env, fetchFn, userId, 'stylist', STYLIST_DAILY_LIMIT, input.date))) {
      return reply('over_quota', 429, { error: 'over_quota' });
    }
  } catch {
    // The closet, profile or quota read failed; Claude wasn't called.
    return reply('error', 500, { error: 'internal' });
  }

  let weather: ReturnType<ToolEnv['weather']> | null = null;
  const tools: ToolEnv = {
    garments,
    date: input.date,
    variant: input.turns.filter((turn) => turn.role === 'assistant').length,
    weather: () =>
      (weather ??= getLocalWeather(env, fetchFn, {
        city_name: profile?.city_name ?? null,
        city_lat: profile?.city_lat ?? null,
        city_lon: profile?.city_lon ?? null,
      })),
  };
  const context = { garments, profile, language: input.language };
  const messages: unknown[] = input.turns.map((turn) => ({ role: turn.role, content: turn.text }));
  let suggested: string[] | null = null;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const left = deadline - now();
    if (left < MIN_CALL_MS) break;
    const answer = await runClaude(env, fetchFn, buildStylistRequest(context, messages, { final: round === MAX_TOOL_ROUNDS }), left);
    if (answer === null) return reply('unavailable', 503, { error: 'analysis_unavailable' });
    const step = parseStep(answer);
    if (step.kind === 'failed') return reply('unreadable', 503, { error: 'analysis_unavailable' });

    if (step.kind === 'reply') {
      const text = sanitizeReply(step.text);
      if (text === '') return reply('unreadable', 503, { error: 'analysis_unavailable' });
      const outfit = suggested === null ? null : ownOutfit(suggested, garments);
      const result: StylistResponse = { kind: 'ok', reply: text, ...(outfit === null ? {} : { outfit: { garment_ids: outfit } }) };
      return reply('answered', 200, result, { rounds: String(round) });
    }

    // A tool call on the last call (which allows none) means the model won't answer.
    if (round === MAX_TOOL_ROUNDS) return reply('unreadable', 503, { error: 'analysis_unavailable' });
    const outcomes = await Promise.all(step.calls.map((call) => runTool(call.name, call.input, tools)));
    for (const outcome of outcomes) if (outcome.outfit !== undefined) suggested = outcome.outfit;
    // The assistant turn goes back unchanged (thinking blocks included), then every result in one user turn.
    messages.push({ role: 'assistant', content: step.content });
    messages.push({
      role: 'user',
      content: step.calls.map((call, index) => {
        const outcome = outcomes.at(index);
        return {
          type: 'tool_result',
          tool_use_id: call.id,
          ...(outcome?.isError === true ? { is_error: true } : {}),
          content: JSON.stringify(outcome?.content ?? null),
        };
      }),
    });
  }
  return reply('unavailable', 503, { error: 'analysis_unavailable' });
}
