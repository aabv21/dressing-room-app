import { readEnv } from '../_shared/env.ts';
import { handlePushClaim } from './handler.ts';

const env = readEnv((name) => Deno.env.get(name), ['service', 'push']);

Deno.serve((req) => handlePushClaim(req, { env, fetch }));
