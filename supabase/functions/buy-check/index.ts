import { readEnv } from '../_shared/env.ts';
import { handleBuyCheck } from './handler.ts';

const env = readEnv((name) => Deno.env.get(name), ['supabase', 'claude']);

Deno.serve((req) => handleBuyCheck(req, { env, fetch }));
