import { appleEnvFrom, readEnv } from '../_shared/env.ts';
import { handleDeleteAccount } from './handler.ts';

const get = (name: string): string | undefined => Deno.env.get(name);
const deps = { env: readEnv(get, ['supabase']), apple: appleEnvFrom(get), fetch };

Deno.serve((req) => handleDeleteAccount(req, deps));
