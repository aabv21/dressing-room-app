import { readEnv } from '../_shared/env.ts';
import { handleForYou } from './handler.ts';

// For you reads no weather; it geocodes a typed city for its season's hemisphere.
const env = readEnv((name) => Deno.env.get(name), ['supabase', 'jev', 'claude', 'geocoding']);

Deno.serve((req) => handleForYou(req, { env, fetch }));
