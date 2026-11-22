// Sends Expo push messages and deletes the tokens Expo says are gone (docs/api.md#push-notifications).
// Logs nothing: callers log outcome words, never a token.

import type { PushEnv, ServiceEnv } from './env.ts';
import { isRecord } from './guards.ts';
import { fetchWithDeadline } from './http.ts';
import { restJson, serviceHeaders } from './userContext.ts';

/** The Android channel the app creates when a notice is turned on. */
export const PUSH_CHANNEL_ID = 'app-notices';
/** Expo's limit per send request. */
export const EXPO_PUSH_BATCH = 100;
export const EXPO_PUSH_TIMEOUT_MS = 5_000;

/** A visible notice (`data.url` is the route a tap opens), or a data-only message the app reads silently. */
export type PushMessage =
  | { to: string; title: string; body: string; data: { url: string } & Record<string, unknown> }
  | { to: string; data: Record<string, unknown> };

/** What Expo gets: a notice on the app's channel with the default sound; a data-only one at high priority, waking iOS. */
function wireFormat(message: PushMessage): Record<string, unknown> {
  return 'title' in message
    ? { ...message, channelId: PUSH_CHANNEL_ID, sound: 'default' }
    : { ...message, priority: 'high', _contentAvailable: true };
}

/** `dead` holds the tokens whose ticket said `DeviceNotRegistered`. */
export type PushResult = { sent: number; failed: number; dead: string[] };

/** The answer's tickets when there is one per message, else null. */
function ticketsOf(value: unknown, length: number): unknown[] | null {
  return isRecord(value) && Array.isArray(value.data) && value.data.length === length ? (value.data as unknown[]) : null;
}

// NOTE: only tickets are read, not receipts (an FCM/APNs rejection after Expo accepted); upgrade: a delayed receipts job, if dead tokens pile up.
async function sendBatch(env: PushEnv, fetchFn: typeof fetch, batch: readonly PushMessage[]): Promise<PushResult> {
  const failed: PushResult = { sent: 0, failed: batch.length, dead: [] };
  try {
    const headers: Record<string, string> = { accept: 'application/json', 'content-type': 'application/json' };
    if (env.expoAccessToken !== '') headers.authorization = `Bearer ${env.expoAccessToken}`;
    const body = JSON.stringify(batch.map(wireFormat));
    const response = await fetchWithDeadline(fetchFn, env.expoPushUrl, { method: 'POST', headers, body }, EXPO_PUSH_TIMEOUT_MS);
    if (!response.ok) return failed;
    const tickets = ticketsOf((await response.json()) as unknown, batch.length);
    if (tickets === null) return failed;
    // Tickets come back in the order the messages were sent.
    const result: PushResult = { sent: 0, failed: 0, dead: [] };
    tickets.forEach((ticket, index) => {
      if (isRecord(ticket) && ticket.status === 'ok') {
        result.sent += 1;
        return;
      }
      result.failed += 1;
      const token = batch.at(index)?.to;
      if (isRecord(ticket) && isRecord(ticket.details) && ticket.details.error === 'DeviceNotRegistered' && token !== undefined) {
        result.dead.push(token);
      }
    });
    return result;
  } catch {
    return failed;
  }
}

/** Sends in batches of `EXPO_PUSH_BATCH`, one after another; a failed batch never stops the next. Never throws. */
export async function sendPushes(env: PushEnv, fetchFn: typeof fetch, messages: readonly PushMessage[]): Promise<PushResult> {
  const total: PushResult = { sent: 0, failed: 0, dead: [] };
  for (let start = 0; start < messages.length; start += EXPO_PUSH_BATCH) {
    const result = await sendBatch(env, fetchFn, messages.slice(start, start + EXPO_PUSH_BATCH));
    total.sent += result.sent;
    total.failed += result.failed;
    total.dead.push(...result.dead);
  }
  return total;
}

const quoted = (token: string): string => `"${token.replace(/["\\]/g, '\\$&')}"`;

/** Deletes every row holding one of `tokens`, whoever's: Expo said the phone no longer takes them. Throws on failure. */
export async function deleteTokens(env: ServiceEnv, fetchFn: typeof fetch, tokens: readonly string[]): Promise<void> {
  if (tokens.length === 0) return;
  const list = encodeURIComponent(`in.(${tokens.map(quoted).join(',')})`);
  await restJson(fetchFn, `${env.supabaseUrl}/rest/v1/push_tokens?token=${list}&select=token`, {
    method: 'DELETE',
    headers: { ...serviceHeaders(env), prefer: 'return=representation' },
  });
}
