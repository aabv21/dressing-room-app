import { readEnv } from '../_shared/env.ts';
import { handleWeeklySummary } from './handler.ts';

const env = readEnv((name) => Deno.env.get(name), ['service', 'push', 'weekly']);

Deno.serve((req) => handleWeeklySummary(req, { env, fetch }));
