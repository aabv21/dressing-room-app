/** @jest-environment node */
// supabase/functions/_shared/__tests__/photoStore.test.ts
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  downloadObject,
  LIST_CONCURRENCY,
  LIST_PAGE,
  listUserObjects,
  photoPath,
  REMOVE_CHUNK,
  removeObjects,
  SIGN_CHUNK,
  signedUrl,
  signedUrls,
  type StorageEnv,
} from '../photoStore.ts';

const USER_ID = '8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OTHER_ID = '9b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
const GARMENT_ID = '3f0c9a52-6d1e-4c8b-9a77-2b1f5e0d4c11';

const ENV: StorageEnv = { supabaseUrl: 'http://supabase.test', serviceRoleKey: 'service-role-test' };

const garmentId = (n: number): string => `10000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

type Call = { method: string; url: URL; headers: Headers; body: string };

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const hrefOf = (input: RequestInfo | URL): string => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

/** A fake `fetch` that records every call and answers with `respond`. */
function fakeFetch(respond: (call: Call) => Response | Promise<Response>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      url: new URL(hrefOf(input)),
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : '',
    };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

function expectServiceRole(calls: readonly Call[]): void {
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) {
    expect(call.url.origin).toBe(ENV.supabaseUrl);
    expect(call.headers.get('apikey')).toBe('service-role-test');
    expect(call.headers.get('authorization')).toBe('Bearer service-role-test');
  }
}

/** Storage's `list`: the entries one level under `prefix`, folders with a null id, sorted by name and paged. */
function listEntries(objects: readonly string[], prefix: string, limit: number, offset: number): unknown[] {
  const entries = new Map<string, boolean>();
  for (const path of objects) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf('/');
    entries.set(slash === -1 ? rest : rest.slice(0, slash), slash !== -1);
  }
  return [...entries]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(offset, offset + limit)
    .map(([name, folder]) => (folder ? { name, id: null, metadata: null } : { name, id: `obj-${name}`, metadata: { size: 1 } }));
}

/** A storage holding `objects` that answers the list route, tracking how many lists are in flight. */
function listingStorage(objects: readonly string[]): { fetch: typeof fetch; calls: Call[]; peak: () => number } {
  let inFlight = 0;
  let peak = 0;
  const fake = fakeFetch(async (call) => {
    if (call.method !== 'POST' || call.url.pathname !== '/storage/v1/object/list/garments') throw new Error(`unexpected ${call.url.href}`);
    const { prefix, limit, offset } = JSON.parse(call.body) as { prefix: string; limit: number; offset: number };
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight -= 1;
    return json(200, listEntries(objects, prefix, limit, offset));
  });
  return { ...fake, peak: () => peak };
}

const photos = (userId: string, count: number): string[] =>
  Array.from({ length: count }, (_, n) => [photoPath(userId, garmentId(n), 'full'), photoPath(userId, garmentId(n), 'thumb')]).flat();

describe('photoPath', () => {
  test('builds {uid}/{garmentId}/{kind}.webp', () => {
    expect(photoPath(USER_ID, GARMENT_ID, 'full')).toBe(`${USER_ID}/${GARMENT_ID}/full.webp`);
    expect(photoPath(USER_ID, GARMENT_ID, 'thumb')).toBe(`${USER_ID}/${GARMENT_ID}/thumb.webp`);
  });

  test.each([
    ['an empty user id', '', GARMENT_ID],
    ['a user id that climbs a folder', '..', GARMENT_ID],
    ['a garment id with a slash', USER_ID, `${GARMENT_ID}/x`],
  ])('refuses %s', (_name, userId, garment) => {
    expect(() => photoPath(userId, garment, 'full')).toThrow();
  });
});

describe('listUserObjects', () => {
  test('lists every object under {uid}/, recursively, with the service role', async () => {
    const objects = [...photos(USER_ID, 3), `${USER_ID}/loose.webp`, ...photos(OTHER_ID, 2)];
    const { fetch: fetchFn, calls } = listingStorage(objects);

    const listed = await listUserObjects(ENV, fetchFn, USER_ID);

    expect(listed.sort()).toEqual([...photos(USER_ID, 3), `${USER_ID}/loose.webp`].sort());
    expectServiceRole(calls);
    const root = calls[0];
    expect(root?.method).toBe('POST');
    expect(root?.url.href).toBe(`${ENV.supabaseUrl}/storage/v1/object/list/garments`);
    expect(root?.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(root?.body ?? '')).toEqual({
      prefix: `${USER_ID}/`,
      limit: LIST_PAGE,
      offset: 0,
      sortBy: { column: 'name', order: 'asc' },
    });
    // The root, then each of the three garment folders.
    expect(calls.map((call) => (JSON.parse(call.body) as { prefix: string }).prefix).sort()).toEqual(
      [`${USER_ID}/`, ...[0, 1, 2].map((n) => `${USER_ID}/${garmentId(n)}/`)].sort(),
    );
  });

  test('pages past 1000 entries in one folder', async () => {
    const { fetch: fetchFn, calls } = listingStorage(photos(USER_ID, 1001));

    const listed = await listUserObjects(ENV, fetchFn, USER_ID);

    expect(LIST_PAGE).toBe(1000);
    expect(listed).toHaveLength(2002);
    const rootPages = calls
      .map((call) => JSON.parse(call.body) as { prefix: string; offset: number })
      .filter((body) => body.prefix === `${USER_ID}/`)
      .map((body) => body.offset);
    expect(rootPages).toEqual([0, 1000]);
  });

  test('lists the garment folders at most 5 at a time', async () => {
    const storage = listingStorage(photos(USER_ID, 40));

    expect(await listUserObjects(ENV, storage.fetch, USER_ID)).toHaveLength(80);
    expect(LIST_CONCURRENCY).toBe(5);
    expect(storage.peak()).toBeGreaterThan(1);
    expect(storage.peak()).toBeLessThanOrEqual(LIST_CONCURRENCY);
  });

  test('answers an empty list for an empty folder', async () => {
    const { fetch: fetchFn, calls } = listingStorage(photos(OTHER_ID, 2));

    expect(await listUserObjects(ENV, fetchFn, USER_ID)).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  test.each([
    ['a 5xx', () => json(500, { error: 'boom' })],
    ['something that is not a list', () => json(200, { nope: true })],
    ['an entry with a slash in its name', () => json(200, [{ name: 'a/b', id: 'x' }])],
  ])('throws on %s', async (_name, answer) => {
    const { fetch: fetchFn } = fakeFetch(answer);

    await expect(listUserObjects(ENV, fetchFn, USER_ID)).rejects.toThrow();
  });

  test('refuses a user id that is not a uuid, touching nothing', async () => {
    const { fetch: fetchFn, calls } = fakeFetch(() => json(200, []));

    await expect(listUserObjects(ENV, fetchFn, '')).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe('removeObjects', () => {
  test('removes in chunks of 1000 paths with the service role', async () => {
    const paths = Array.from({ length: 2001 }, (_, n) => `${USER_ID}/${garmentId(n)}/full.webp`);
    const { fetch: fetchFn, calls } = fakeFetch(() => json(200, []));

    await removeObjects(ENV, fetchFn, paths);

    expect(REMOVE_CHUNK).toBe(1000);
    expectServiceRole(calls);
    for (const call of calls) {
      expect(call.method).toBe('DELETE');
      expect(call.url.href).toBe(`${ENV.supabaseUrl}/storage/v1/object/garments`);
      expect(call.headers.get('content-type')).toBe('application/json');
    }
    const sent = calls.map((call) => (JSON.parse(call.body) as { prefixes: string[] }).prefixes);
    expect(sent.map((chunk) => chunk.length)).toEqual([1000, 1000, 1]);
    expect(sent.flat()).toEqual(paths);
  });

  test('makes no call for no paths', async () => {
    const { fetch: fetchFn, calls } = fakeFetch(() => json(200, []));

    await removeObjects(ENV, fetchFn, []);

    expect(calls).toHaveLength(0);
  });

  test('throws on a 5xx and stops at that chunk', async () => {
    const paths = Array.from({ length: 1500 }, (_, n) => `${USER_ID}/${garmentId(n)}/full.webp`);
    const { fetch: fetchFn, calls } = fakeFetch(() => json(503, { error: 'unavailable' }));

    await expect(removeObjects(ENV, fetchFn, paths)).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
});

describe('signedUrl', () => {
  const path = photoPath(USER_ID, GARMENT_ID, 'full');

  test('signs one path for the given time and answers the full URL', async () => {
    const { fetch: fetchFn, calls } = fakeFetch(() => json(200, { signedURL: `/object/sign/garments/${path}?token=t-1` }));

    const url = await signedUrl(ENV, fetchFn, path, 600);

    expect(url).toBe(`${ENV.supabaseUrl}/storage/v1/object/sign/garments/${path}?token=t-1`);
    expectServiceRole(calls);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url.href).toBe(`${ENV.supabaseUrl}/storage/v1/object/sign/garments/${path}`);
    expect(calls[0]?.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual({ expiresIn: 600 });
  });

  test('answers null on a 404', async () => {
    const { fetch: fetchFn } = fakeFetch(() => json(404, { statusCode: '404', error: 'not_found', message: 'Object not found' }));

    expect(await signedUrl(ENV, fetchFn, path, 600)).toBeNull();
  });

  test('answers null when Storage reports a missing object as a 400 with a 404 status code', async () => {
    const { fetch: fetchFn } = fakeFetch(() => json(400, { statusCode: '404', error: 'not_found', message: 'Object not found' }));

    expect(await signedUrl(ENV, fetchFn, path, 600)).toBeNull();
  });

  test.each([
    ['a 5xx', () => json(500, { error: 'boom' })],
    ['an answer without a URL', () => json(200, { nope: true })],
  ])('throws on %s', async (_name, answer) => {
    const { fetch: fetchFn } = fakeFetch(answer);

    await expect(signedUrl(ENV, fetchFn, path, 600)).rejects.toThrow();
  });
});

describe('signedUrls', () => {
  test('signs paths in chunks of 500 and answers the URL of each one that exists', async () => {
    const paths = Array.from({ length: 501 }, (_, n) => photoPath(USER_ID, garmentId(n), 'thumb'));
    const missing = paths[3] ?? '';
    const { fetch: fetchFn, calls } = fakeFetch((call) => {
      const { paths: sent } = JSON.parse(call.body) as { paths: string[] };
      return json(
        200,
        sent.map((path) =>
          path === missing
            ? { path, signedURL: null, error: 'Either the object does not exist or you do not have access to it' }
            : { path, signedURL: `/object/sign/garments/${path}?token=t`, error: null },
        ),
      );
    });

    const urls = await signedUrls(ENV, fetchFn, paths, 3600);

    expect(SIGN_CHUNK).toBe(500);
    expectServiceRole(calls);
    for (const call of calls) {
      expect(call.method).toBe('POST');
      expect(call.url.href).toBe(`${ENV.supabaseUrl}/storage/v1/object/sign/garments`);
      expect((JSON.parse(call.body) as { expiresIn: number }).expiresIn).toBe(3600);
    }
    expect(calls.map((call) => (JSON.parse(call.body) as { paths: string[] }).paths.length)).toEqual([500, 1]);
    expect(urls.size).toBe(500);
    expect(urls.has(missing)).toBe(false);
    expect(urls.get(paths[0] ?? '')).toBe(`${ENV.supabaseUrl}/storage/v1/object/sign/garments/${paths[0] ?? ''}?token=t`);
  });

  test('makes no call for no paths', async () => {
    const { fetch: fetchFn, calls } = fakeFetch(() => json(200, []));

    expect((await signedUrls(ENV, fetchFn, [], 3600)).size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  test.each([
    ['a 5xx', () => json(500, { error: 'boom' })],
    ['something that is not a list', () => json(200, { nope: true })],
  ])('throws on %s', async (_name, answer) => {
    const { fetch: fetchFn } = fakeFetch(answer);

    await expect(signedUrls(ENV, fetchFn, [photoPath(USER_ID, GARMENT_ID, 'full')], 3600)).rejects.toThrow();
  });
});

describe('downloadObject', () => {
  const path = photoPath(USER_ID, GARMENT_ID, 'full');

  test('downloads the object bytes with the service role', async () => {
    const bytes = Uint8Array.from([1, 2, 3, 250]);
    const { fetch: fetchFn, calls } = fakeFetch(() => new Response(bytes, { status: 200, headers: { 'content-type': 'image/webp' } }));

    expect(await downloadObject(ENV, fetchFn, path)).toEqual(bytes);
    expectServiceRole(calls);
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url.href).toBe(`${ENV.supabaseUrl}/storage/v1/object/garments/${path}`);
  });

  test('answers null on a 404', async () => {
    const { fetch: fetchFn } = fakeFetch(() => json(404, { statusCode: '404', error: 'not_found', message: 'Object not found' }));

    expect(await downloadObject(ENV, fetchFn, path)).toBeNull();
  });

  test('answers null when Storage reports a missing object as a 400 with a 404 status code', async () => {
    const { fetch: fetchFn } = fakeFetch(() => json(400, { statusCode: '404', error: 'not_found', message: 'Object not found' }));

    expect(await downloadObject(ENV, fetchFn, path)).toBeNull();
  });

  test.each([
    ['a 5xx', () => json(502, { error: 'bad gateway' })],
    ['another 4xx', () => json(400, { statusCode: '400', error: 'invalid', message: 'bad' })],
  ])('throws on %s', async (_name, answer) => {
    const { fetch: fetchFn } = fakeFetch(answer);

    await expect(downloadObject(ENV, fetchFn, path)).rejects.toThrow();
  });
});

describe('the photo boundary', () => {
  test('no function source outside photoStore.ts names a Storage URL', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the repo's own supabase/functions folder, not user input.
    const sources = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter(
      (file) => file.endsWith('.ts') && !file.split('/').includes('__tests__'),
    );
    expect(sources).toContain('_shared/photoStore.ts');

    const offenders = sources.filter((file) =>
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- files listed from that same folder.
      readFileSync(`${root}${file}`, 'utf8').includes('/storage/v1/'),
    );
    expect(offenders).toEqual(['_shared/photoStore.ts']);
  });
});
