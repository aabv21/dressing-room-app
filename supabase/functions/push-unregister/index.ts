import { readEnv } from '../_shared/env.ts';
import { handlePushUnregister } from './handler.ts';

const env = readEnv((name) => Deno.env.get(name), ['service']);

Deno.serve((req) => handlePushUnregister(req, { env, fetch }));
