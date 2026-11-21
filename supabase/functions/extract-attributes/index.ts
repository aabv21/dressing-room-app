// Deno entry point for `extract-attributes`; the logic is in `handler.ts`.
import { readEnv } from '../_shared/env.ts';
import { handleExtract } from './handler.ts';

const env = readEnv((name) => Deno.env.get(name), ['service', 'claude', 'webhook']);

Deno.serve((req) => handleExtract(req, { env, fetch }));
