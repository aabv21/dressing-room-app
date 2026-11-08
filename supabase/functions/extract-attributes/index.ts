// Deno entry point for the `extract-attributes` Edge Function. All logic lives in `handler.ts`;
// this file only reads the environment and serves requests. `SUPABASE_URL` and
// `SUPABASE_SERVICE_ROLE_KEY` are injected by the Edge Runtime; the rest are function secrets.

import { type ExtractEnv, handleExtract } from './handler.ts';

const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

function required(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value === '') throw new Error(`Missing environment variable ${name}`);
  return value;
}

function readEnv(): ExtractEnv {
  const anthropicBaseUrl = Deno.env.get('ANTHROPIC_BASE_URL');
  return {
    supabaseUrl: required('SUPABASE_URL'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    webhookSecret: required('EXTRACT_WEBHOOK_SECRET'),
    anthropicApiKey: required('ANTHROPIC_API_KEY'),
    anthropicBaseUrl:
      anthropicBaseUrl === undefined || anthropicBaseUrl === '' ? DEFAULT_ANTHROPIC_BASE_URL : anthropicBaseUrl,
  };
}

Deno.serve((req) => handleExtract(req, { env: readEnv(), fetch }));
