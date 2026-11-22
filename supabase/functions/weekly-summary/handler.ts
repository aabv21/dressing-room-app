// The Sunday summary push, called by the pg_cron job through pg_net with the Vault secret
// (docs/api.md#weekly-summary). Logs carry only outcome words and counts.

import type { PushEnv, ServiceEnv, WeeklyEnv } from '../_shared/env.ts';
import { isRecord, UUID } from '../_shared/guards.ts';
import { reply, secretMatches } from '../_shared/http.ts';
import { deleteTokens, sendPushes, type PushMessage } from '../_shared/push.ts';
import { pushLanguageOf, weeklySummaryCopy } from '../_shared/pushCopy.ts';
import { restJson, serviceHeaders, UpstreamError } from '../_shared/userContext.ts';

export type WeeklySummaryEnv = ServiceEnv & PushEnv & WeeklyEnv;

export type WeeklySummaryDeps = { env: WeeklySummaryEnv; fetch: typeof fetch };

type Target = { token: string; language: unknown; outfits: number; unused: number };

/** PostgREST's `max_rows` (1000 here); paging by rows received still reads all under a smaller hosted cap. */
const PAGE = 1000;

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

function isTarget(row: unknown): row is Target {
  return (
    isRecord(row) &&
    typeof row.user_id === 'string' &&
    UUID.test(row.user_id) &&
    typeof row.token === 'string' &&
    isCount(row.outfits) &&
    isCount(row.unused)
  );
}

/** Every row `weekly_summary_targets()` answers, page by page (it orders them itself). */
async function readTargets(deps: WeeklySummaryDeps): Promise<Target[]> {
  const targets: Target[] = [];
  for (let offset = 0; ; ) {
    const url = `${deps.env.supabaseUrl}/rest/v1/rpc/weekly_summary_targets?limit=${String(PAGE)}&offset=${String(offset)}`;
    const page = await restJson(deps.fetch, url, {
      method: 'POST',
      headers: { ...serviceHeaders(deps.env), 'content-type': 'application/json' },
      body: '{}',
    });
    if (!Array.isArray(page) || !page.every(isTarget)) throw new UpstreamError('weekly_summary_targets: unexpected rows');
    if (page.length === 0) return targets;
    targets.push(...page);
    offset += page.length;
  }
}

function messageFor(target: Target): PushMessage {
  return {
    to: target.token,
    ...weeklySummaryCopy(pushLanguageOf(target.language), target.outfits, target.unused),
    data: { kind: 'weeklySummary', url: '/closet?segment=stats' },
  };
}

export async function handleWeeklySummary(request: Request, deps: WeeklySummaryDeps): Promise<Response> {
  if (request.method !== 'POST') return reply('invalid', 405, { error: 'method_not_allowed' });
  if (!secretMatches(request.headers.get('x-webhook-secret'), deps.env.weeklySummarySecret)) {
    return reply('unauthorized', 401, { error: 'unauthorized' });
  }

  let targets: Target[];
  try {
    targets = await readTargets(deps);
  } catch {
    return reply('error', 500, { error: 'internal' });
  }

  const result = await sendPushes(deps.env, deps.fetch, targets.map(messageFor));
  let removed = 0;
  try {
    await deleteTokens(deps.env, deps.fetch, result.dead);
    removed = result.dead.length;
  } catch {
    // Next week's ticket names them again.
  }
  const counts = { targets: targets.length, sent: result.sent, failed: result.failed, removed };
  const words = Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, String(value)]));
  return reply('sent', 200, { outcome: 'sent', ...counts }, words);
}
