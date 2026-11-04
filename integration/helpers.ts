// integration/helpers.ts
//
// Shared setup for the `integration` Jest project: loading `.env.local` (this project runs under
// plain Node, not Expo, so nothing inlines `EXPO_PUBLIC_*` the way Metro does for the app), and
// building the anon/service-role clients the auth and RLS integration suites drive against the
// locally running Supabase stack.

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient, SupportedStorage } from '@supabase/supabase-js';

import type { Database } from '../src/lib/database.types';

const ENV_LOCAL_URL = new URL('../.env.local', import.meta.url);
const REQUIRED_KEYS = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const;

/** Parses simple `KEY=value` lines (same shape `scripts/env-local.ts` writes); no multi-line or `export` support needed. */
function parseEnvFile(contents: string): Map<string, string> {
  const env = new Map<string, string>();
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex);
    env.set(key, trimmed.slice(separatorIndex + 1));
  }
  return env;
}

/** A `Map`-backed view of `process.env`, so lookups by a non-literal key don't trip `security/detect-object-injection`. */
function envMap(): Map<string, string | undefined> {
  return new Map(Object.entries(process.env));
}

/**
 * Loads `.env.local` into `process.env` if the keys this project needs aren't already set.
 *
 * NOTE: this uses a tiny hand-rolled parser instead of Node 24's `process.loadEnvFile` — under
 * Jest's `node` test environment, `process.loadEnvFile` silently no-ops (no error, but
 * `process.env` is never updated; confirmed by direct test under this exact Jest config).
 * Upgrade path: switch back to `process.loadEnvFile` if a future Jest release fixes that
 * interaction, or drop this project onto a runner that doesn't sandbox `process`.
 *
 * Throws a clear, actionable error — naming the missing file or variable — rather than letting
 * every test fail with an opaque "fetch failed" once a client tries to reach a Supabase that was
 * never configured.
 */
export function loadIntegrationEnv(): void {
  if (REQUIRED_KEYS.every((key) => envMap().get(key) !== undefined)) {
    return;
  }

  let contents: string;
  try {
    // ENV_LOCAL_URL is this file's own fixed, hardcoded path — never user input — so this isn't
    // the path-traversal sink the rule guards against.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    contents = readFileSync(ENV_LOCAL_URL, 'utf8');
  } catch (error) {
    throw new Error(
      'integration tests need .env.local (run `pnpm db:start && pnpm env:local` first): ' +
        String(error instanceof Error ? error.message : error),
    );
  }

  const parsed = parseEnvFile(contents);
  const currentEnv = envMap();
  const envUpdates = Object.fromEntries(
    Array.from(parsed, ([key, value]) => [key, currentEnv.get(key) ?? value] as const),
  );
  Object.assign(process.env, envUpdates);

  const stillMissing = REQUIRED_KEYS.find((key) => envMap().get(key) === undefined);
  if (stillMissing !== undefined) {
    throw new Error(`.env.local is missing ${stillMissing} — run \`pnpm db:start && pnpm env:local\` again`);
  }
}

function requiredEnv(key: string): string {
  const value = envMap().get(key);
  if (value === undefined) {
    throw new Error(`${key} is not set — call loadIntegrationEnv() before using Supabase clients`);
  }
  return value;
}

/** A plain in-memory `SupportedStorage`, so each client built in a test has an isolated session. */
function memoryStorage(): SupportedStorage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

/**
 * A service-role client: bypasses RLS, used only to seed/clean up test users and to read other
 * users' rows for assertions (e.g. "B's row is unchanged when read with the service role").
 */
export function serviceClient(): SupabaseClient<Database> {
  return createClient<Database>(requiredEnv('EXPO_PUBLIC_SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { storage: memoryStorage(), autoRefreshToken: false, persistSession: false },
  });
}

/** An anon-key client, the same key shape the app ships — every auth/RLS assertion runs through this. */
export function anonClient(): SupabaseClient<Database> {
  return createClient<Database>(requiredEnv('EXPO_PUBLIC_SUPABASE_URL'), requiredEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY'), {
    auth: { storage: memoryStorage(), autoRefreshToken: false, persistSession: false },
  });
}

/** Builds a unique local-part so repeated test runs never collide on an existing account. */
export function uniqueEmail(label: string): string {
  return `${label}-${randomUUID()}@example.com`;
}

/** Creates an already-confirmed user via the admin API, so tests never need the confirmation flow. */
export async function createUser(email: string, password: string): Promise<string> {
  const { data, error } = await serviceClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error !== null) {
    throw error;
  }
  return data.user.id;
}

/** Deletes a test user by id via the admin API; swallow "not found" so cleanup is idempotent. */
export async function deleteUser(userId: string): Promise<void> {
  const { error } = await serviceClient().auth.admin.deleteUser(userId);
  if (error !== null && error.status !== 404) {
    throw error;
  }
}

interface MailpitAddress {
  Address: string;
}

interface MailpitMessageSummary {
  ID: string;
  To: MailpitAddress[];
}

interface MailpitMessagesResponse {
  messages: MailpitMessageSummary[];
}

interface MailpitMessage {
  Text: string;
}

const MAILPIT_URL = 'http://127.0.0.1:54424';
const MAILPIT_POLL_ATTEMPTS = 10;
const MAILPIT_POLL_INTERVAL_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function findLatestMessageFor(email: string): Promise<MailpitMessageSummary | undefined> {
  const listResponse = await fetch(`${MAILPIT_URL}/api/v1/messages`);
  if (!listResponse.ok) {
    throw new Error(`Mailpit /api/v1/messages returned ${String(listResponse.status)} — is \`pnpm db:start\` running?`);
  }
  const { messages } = (await listResponse.json()) as MailpitMessagesResponse;
  return messages.find((message) => message.To.some((to) => to.Address === email));
}

/**
 * Reads Mailpit's REST API (confirmed against the installed CLI's bundled version: `GET
 * /api/v1/messages` lists messages newest-first, `GET /api/v1/message/{ID}` returns the full
 * body) and extracts the 6-digit code from the newest message addressed to `email`. Polls briefly
 * (up to ~2s) since `resetPasswordForEmail`'s response can resolve a beat before Mailpit has
 * finished recording the message it just received.
 */
export async function latestEmailCode(email: string): Promise<string> {
  let latest: MailpitMessageSummary | undefined;
  for (let attempt = 0; attempt < MAILPIT_POLL_ATTEMPTS && latest === undefined; attempt += 1) {
    if (attempt > 0) {
      await sleep(MAILPIT_POLL_INTERVAL_MS);
    }
    latest = await findLatestMessageFor(email);
  }
  if (latest === undefined) {
    throw new Error(`No Mailpit message found addressed to ${email}`);
  }

  const messageResponse = await fetch(`${MAILPIT_URL}/api/v1/message/${latest.ID}`);
  if (!messageResponse.ok) {
    throw new Error(`Mailpit /api/v1/message/${latest.ID} returned ${String(messageResponse.status)}`);
  }
  const { Text } = (await messageResponse.json()) as MailpitMessage;
  const match = /\b\d{6}\b/.exec(Text);
  if (match === null) {
    throw new Error(`No 6-digit code found in the Mailpit message to ${email}`);
  }
  return match[0];
}
