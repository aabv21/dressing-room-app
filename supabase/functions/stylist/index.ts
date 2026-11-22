import { readEnv } from '../_shared/env.ts';
import { handleStylist } from './handler.ts';

const env = readEnv((name) => Deno.env.get(name), ['supabase', 'claude', 'weather']);

Deno.serve((req) => handleStylist(req, { env, fetch }));
