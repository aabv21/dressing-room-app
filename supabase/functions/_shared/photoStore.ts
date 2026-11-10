// The one place the functions reach the `garments` Storage bucket: building a photo's path, listing
// and removing a user's objects, signing URLs and downloading an object, all with the service role.
// No other function file builds a `/storage/v1/` URL (a `functions` test checks this), so every
// photo access can be found, reviewed and changed here.
//
// Paths are `{uid}/{garmentId}/{full,thumb}.webp`. Storage answers a missing object with a 404, or
// (the version the local stack runs) a 400 whose body says `statusCode: "404"`; both count as
// missing (`null`), and any other failure throws.
//
// Runtime-neutral: every effect goes through the injected `fetch`, so Jest drives it under Node and
// the Edge Functions run it under Deno.

import { isRecord } from './extraction.ts';
import { mapLimit, restJson, serviceHeaders, type SupabaseEnv, UpstreamError, UUID } from './userContext.ts';

/** What a Storage call needs: the project URL and the service-role key. */
export type StorageEnv = Pick<SupabaseEnv, 'supabaseUrl' | 'serviceRoleKey'>;

export type PhotoKind = 'full' | 'thumb';

export const PHOTO_KINDS = ['full', 'thumb'] as const satisfies readonly PhotoKind[];

const BUCKET = 'garments';
/** Storage's list page size. */
export const LIST_PAGE = 1000;
/** The most paths one remove call takes. */
export const REMOVE_CHUNK = 1000;
/** At most this many folder listings in flight at once. */
export const LIST_CONCURRENCY = 5;
/** The most paths one batch-sign call takes. */
export const SIGN_CHUNK = 500;

const storageUrl = (env: StorageEnv, route: string): string => `${env.supabaseUrl}/storage/v1/${route}`;

/** An object path as a URL path, each segment encoded (photo paths are uuids and pass unchanged). */
const encodePath = (path: string): string => path.split('/').map(encodeURIComponent).join('/');

function assertUuid(id: string, what: string): void {
  if (!UUID.test(id)) throw new Error(`photoStore: ${what} is not a uuid`);
}

/** `{uid}/{garmentId}/{kind}.webp`; throws when either id isn't a uuid. */
export function photoPath(userId: string, garmentId: string, kind: PhotoKind): string {
  assertUuid(userId, 'user id');
  assertUuid(garmentId, 'garment id');
  return `${userId}/${garmentId}/${kind}.webp`;
}

/** True when a non-2xx Storage answer means the object doesn't exist. */
async function isNotFound(response: Response): Promise<boolean> {
  if (response.status === 404) return true;
  if (response.status !== 400) return false;
  try {
    const body: unknown = await response.json();
    return isRecord(body) && body.statusCode === '404';
  } catch {
    return false;
  }
}

/** The entries one level under `prefix` (which ends in `/`): files by path, folders by their own prefix. */
async function listLevel(env: StorageEnv, fetchFn: typeof fetch, prefix: string): Promise<{ files: string[]; folders: string[] }> {
  const files: string[] = [];
  const folders: string[] = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const page = await restJson(fetchFn, storageUrl(env, `object/list/${BUCKET}`), {
      method: 'POST',
      headers: { ...serviceHeaders(env), 'content-type': 'application/json' },
      body: JSON.stringify({ prefix, limit: LIST_PAGE, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!Array.isArray(page)) throw new UpstreamError('storage list: not an array');
    for (const entry of page as unknown[]) {
      if (!isRecord(entry) || typeof entry.name !== 'string' || entry.name === '' || entry.name.includes('/')) {
        throw new UpstreamError('storage list: unexpected entry');
      }
      if (entry.id === null) folders.push(`${prefix}${entry.name}/`);
      else files.push(`${prefix}${entry.name}`);
    }
    if (page.length < LIST_PAGE) return { files, folders };
  }
}

/**
 * Every object path under `prefix`. Storage's list answers one level at a time, a folder with a
 * null `id`, so each level is paged until a short page and its folders are listed
 * `LIST_CONCURRENCY` at a time.
 */
async function listObjects(env: StorageEnv, fetchFn: typeof fetch, prefix: string): Promise<string[]> {
  const { files, folders } = await listLevel(env, fetchFn, prefix);
  const nested = await mapLimit(folders, LIST_CONCURRENCY, (folder) => listObjects(env, fetchFn, folder));
  return [...files, ...nested.flat()];
}

/** Every object path under `{uid}/`, at any depth; throws when any listing fails. */
export async function listUserObjects(env: StorageEnv, fetchFn: typeof fetch, userId: string): Promise<string[]> {
  assertUuid(userId, 'user id');
  return listObjects(env, fetchFn, `${userId}/`);
}

/** Removes `paths`, `REMOVE_CHUNK` per call, in order; throws at the first chunk that fails. */
export async function removeObjects(env: StorageEnv, fetchFn: typeof fetch, paths: readonly string[]): Promise<void> {
  for (let start = 0; start < paths.length; start += REMOVE_CHUNK) {
    const response = await fetchFn(storageUrl(env, `object/${BUCKET}`), {
      method: 'DELETE',
      headers: { ...serviceHeaders(env), 'content-type': 'application/json' },
      body: JSON.stringify({ prefixes: paths.slice(start, start + REMOVE_CHUNK) }),
    });
    if (!response.ok) throw new UpstreamError(`storage remove: HTTP ${String(response.status)}`);
  }
}

/** Storage's relative `signedURL` (`/object/sign/…?token=…`) as an absolute URL. */
const absoluteSignedUrl = (env: StorageEnv, signedURL: string): string => encodeURI(`${env.supabaseUrl}/storage/v1${signedURL}`);

/** A URL that reads `path` for `expiresInSeconds`; null when the object doesn't exist. */
export async function signedUrl(
  env: StorageEnv,
  fetchFn: typeof fetch,
  path: string,
  expiresInSeconds: number,
): Promise<string | null> {
  const response = await fetchFn(storageUrl(env, `object/sign/${BUCKET}/${encodePath(path)}`), {
    method: 'POST',
    headers: { ...serviceHeaders(env), 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn: expiresInSeconds }),
  });
  if (!response.ok) {
    if (await isNotFound(response)) return null;
    throw new UpstreamError(`storage sign: HTTP ${String(response.status)}`);
  }
  const body: unknown = await response.json();
  if (!isRecord(body) || typeof body.signedURL !== 'string') throw new UpstreamError('storage sign: no URL');
  return absoluteSignedUrl(env, body.signedURL);
}

/**
 * The signed URL of every path in `paths` that exists (by path), `SIGN_CHUNK` paths per call. A
 * missing object is simply absent from the map; a failed call throws.
 */
export async function signedUrls(
  env: StorageEnv,
  fetchFn: typeof fetch,
  paths: readonly string[],
  expiresInSeconds: number,
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  for (let start = 0; start < paths.length; start += SIGN_CHUNK) {
    const answer = await restJson(fetchFn, storageUrl(env, `object/sign/${BUCKET}`), {
      method: 'POST',
      headers: { ...serviceHeaders(env), 'content-type': 'application/json' },
      body: JSON.stringify({ expiresIn: expiresInSeconds, paths: paths.slice(start, start + SIGN_CHUNK) }),
    });
    if (!Array.isArray(answer)) throw new UpstreamError('storage sign: not an array');
    for (const entry of answer as unknown[]) {
      // A path with no object comes back with an error and no URL.
      if (isRecord(entry) && typeof entry.path === 'string' && typeof entry.signedURL === 'string') {
        urls.set(entry.path, absoluteSignedUrl(env, entry.signedURL));
      }
    }
  }
  return urls;
}

/** The bytes stored at `path`; null when the object doesn't exist. */
export async function downloadObject(env: StorageEnv, fetchFn: typeof fetch, path: string): Promise<Uint8Array | null> {
  const response = await fetchFn(storageUrl(env, `object/${BUCKET}/${encodePath(path)}`), { headers: serviceHeaders(env) });
  if (!response.ok) {
    if (await isNotFound(response)) return null;
    throw new UpstreamError(`storage download: HTTP ${String(response.status)}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
