import { readEnv } from '../_shared/env.ts';
import { handleExportData } from './handler.ts';

const env = readEnv((name) => Deno.env.get(name), ['supabase']);

Deno.serve((req) => handleExportData(req, { env, fetch }));
