// Everything the caller owns as one JSON document (docs/database.md, "Account deletion and data
// export"). Logs carry only an outcome word.

// NOTE: local exports' signed URLs use the internal gateway `SUPABASE_URL`; upgrade: a public-URL function secret.

import type { SupabaseEnv } from '../_shared/env.ts';
import { isRecord, UUID } from '../_shared/guards.ts';
import { callerOf, reply } from '../_shared/http.ts';
import { PHOTO_KINDS, photoPath, signedUrls } from '../_shared/photoStore.ts';
import { restRows, userHeaders } from '../_shared/userContext.ts';

export type ExportDataDeps = { env: SupabaseEnv; fetch: typeof fetch; now?: () => number };

type Row = Record<string, unknown>;

export type ExportPhoto = { garmentId: string; full: string | null; thumb: string | null };

export type DataExport = {
  exportedAt: string;
  profile: Row | null;
  garments: Row[];
  /** Each outfit row with `items: [{ garment_id }]`. */
  outfits: Row[];
  wears: Row[];
  photos: ExportPhoto[];
};

export const SIGNED_URL_TTL_S = 7 * 24 * 60 * 60;
/** PostgREST's `max_rows` (1000 here); paging by rows received still reads all under a smaller hosted cap. */
export const PAGE = 1000;

/** Every row of `table` the caller can read, `user_id = caller` and in a stable `order`, page by page. */
async function readAll(
  env: SupabaseEnv,
  fetchFn: typeof fetch,
  auth: string,
  userId: string,
  table: string,
  select: string,
  order: string,
): Promise<Row[]> {
  const rows: Row[] = [];
  const base = `${env.supabaseUrl}/rest/v1/${table}?select=${encodeURIComponent(select)}&user_id=eq.${userId}&order=${order}`;
  for (let offset = 0; ; ) {
    const page = await restRows(fetchFn, `${base}&limit=${String(PAGE)}&offset=${String(offset)}`, userHeaders(env, auth));
    if (page.length === 0) return rows;
    for (const row of page) {
      // RLS already scopes every read to the caller; this keeps a policy mistake out of the file.
      if (isRecord(row) && row.user_id === userId) rows.push(row);
    }
    offset += page.length;
  }
}

async function photosOf(
  env: SupabaseEnv,
  fetchFn: typeof fetch,
  userId: string,
  garments: readonly Row[],
): Promise<ExportPhoto[]> {
  const ids = garments.flatMap((garment) => (typeof garment.id === 'string' && UUID.test(garment.id) ? [garment.id] : []));
  const urls = await signedUrls(
    env,
    fetchFn,
    ids.flatMap((id) => PHOTO_KINDS.map((kind) => photoPath(userId, id, kind))),
    SIGNED_URL_TTL_S,
  );
  return ids.flatMap((garmentId) => {
    const full = urls.get(photoPath(userId, garmentId, 'full')) ?? null;
    const thumb = urls.get(photoPath(userId, garmentId, 'thumb')) ?? null;
    return full === null && thumb === null ? [] : [{ garmentId, full, thumb }];
  });
}

export async function handleExportData(request: Request, deps: ExportDataDeps): Promise<Response> {
  const now = deps.now ?? Date.now;
  if (request.method !== 'POST') return reply('invalid', 405, { error: 'method_not_allowed' });
  const caller = callerOf(request);
  if (caller === null) return reply('invalid', 401, { error: 'unauthorized' });
  const { auth, userId } = caller;

  const { env, fetch: fetchFn } = deps;
  try {
    const [profiles, garments, outfits, wears] = await Promise.all([
      readAll(env, fetchFn, auth, userId, 'profiles', '*', 'user_id'),
      readAll(env, fetchFn, auth, userId, 'garments', '*', 'created_at,id'),
      readAll(env, fetchFn, auth, userId, 'outfits', '*,items:outfit_items(garment_id)', 'created_at,id'),
      readAll(env, fetchFn, auth, userId, 'wears', '*', 'worn_on,created_at,id'),
    ]);
    const body: DataExport = {
      exportedAt: new Date(now()).toISOString(),
      profile: profiles[0] ?? null,
      garments,
      outfits,
      wears,
      photos: await photosOf(env, fetchFn, userId, garments),
    };
    return reply('exported', 200, body);
  } catch {
    return reply('error', 500, { error: 'internal' });
  }
}
