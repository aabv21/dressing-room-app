// Deno entry point for the `export-data` Edge Function. All logic lives in `handler.ts`; this file
// only reads the environment and serves requests. `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
// `SUPABASE_SERVICE_ROLE_KEY` are injected by the Edge Runtime.

import type { SupabaseEnv } from '../_shared/userContext.ts';
import { handleExportData } from './handler.ts';

function required(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value === '') throw new Error(`Missing environment variable ${name}`);
  return value;
}

function readEnv(): SupabaseEnv {
  return {
    supabaseUrl: required('SUPABASE_URL'),
    anonKey: required('SUPABASE_ANON_KEY'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  };
}

Deno.serve((req) => handleExportData(req, { env: readEnv(), fetch }));
