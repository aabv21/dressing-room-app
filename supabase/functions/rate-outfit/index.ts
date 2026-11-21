import { readEnv } from '../_shared/env.ts';
import { handleRate } from './handler.ts';

const env = readEnv((name) => Deno.env.get(name), ['supabase', 'jev', 'claude', 'weather']);

Deno.serve((req) => handleRate(req, { env, fetch }));
