import { readEnv } from '../_shared/env.ts';
import { handleExtract } from './handler.ts';

const env = readEnv((name) => Deno.env.get(name), ['service', 'claude', 'webhook', 'push']);

Deno.serve((req) => handleExtract(req, { env, fetch }));
