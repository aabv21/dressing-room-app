import { readEnv } from '../_shared/env.ts';
import { handleLucky } from './handler.ts';

// No Claude: a failed rating keeps its pre-score order.
const env = readEnv((name) => Deno.env.get(name), ['supabase', 'jev', 'weather']);

Deno.serve((req) => handleLucky(req, { env, fetch }));
