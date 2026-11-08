// Deno entry point for the `rate-outfit` Edge Function. All logic lives in `handler.ts`; this file
// only reads the environment and serves requests. `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
// `SUPABASE_SERVICE_ROLE_KEY` are injected by the Edge Runtime; the rest are function secrets.

import type { FnEnv } from '../_shared/userContext.ts';
import { handleRate } from './handler.ts';

function required(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value === '') throw new Error(`Missing environment variable ${name}`);
  return value;
}

function withDefault(name: string, fallback: string): string {
  const value = Deno.env.get(name);
  return value === undefined || value === '' ? fallback : value;
}

function readEnv(): FnEnv {
  return {
    supabaseUrl: required('SUPABASE_URL'),
    anonKey: required('SUPABASE_ANON_KEY'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    typesafeApiKey: required('TYPESAFE_API_KEY'),
    typesafeBaseUrl: withDefault('TYPESAFE_BASE_URL', 'https://api.typesafe.ai'),
    anthropicApiKey: required('ANTHROPIC_API_KEY'),
    anthropicBaseUrl: withDefault('ANTHROPIC_BASE_URL', 'https://api.anthropic.com'),
    openMeteoUrl: withDefault('OPEN_METEO_URL', 'https://api.open-meteo.com'),
    geocodingUrl: withDefault('OPEN_METEO_GEOCODING_URL', 'https://geocoding-api.open-meteo.com'),
  };
}

Deno.serve((req) => handleRate(req, { env: readEnv(), fetch }));
