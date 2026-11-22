import { readEnv } from '../_shared/env.ts';
import { handleTripPlan } from './handler.ts';

// No Jev and no Claude: a trip is ranked by the pre-score alone.
const env = readEnv((name) => Deno.env.get(name), ['supabase', 'weather']);

Deno.serve((req) => handleTripPlan(req, { env, fetch }));
