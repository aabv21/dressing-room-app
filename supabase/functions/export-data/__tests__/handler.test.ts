/** @jest-environment node */
// supabase/functions/export-data/__tests__/handler.test.ts
import type { SupabaseEnv } from '../../_shared/userContext.ts';
import { handleExportData, SIGNED_URL_TTL_S } from '../handler.ts';

const { jest } = import.meta;

const USER_ID = '8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OTHER_ID = '9b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
const NOW = Date.parse('2026-11-09T12:00:00Z');

const ENV: SupabaseEnv = {
  supabaseUrl: 'http://supabase.test',
  anonKey: 'anon-key-test',
  serviceRoleKey: 'service-role-test',
};

const base64url = (text: string): string => Buffer.from(text, 'utf8').toString('base64url');
const token = (claims: unknown): string =>
  `${base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${base64url(JSON.stringify(claims))}.signature`;
const AUTH = `Bearer ${token({ sub: USER_ID, role: 'authenticated' })}`;

type Row = Record<string, unknown>;

const idOf = (n: number): string => `10000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const PROFILE: Row = { user_id: USER_ID, clothing_type: 'feminine', body_type: 'pear', height_cm: 164, waist_cm: 71, language: 'es' };
const GARMENTS: Row[] = [
  { id: idOf(1), user_id: USER_ID, category: 't_shirt', colors: ['white'], status: 'available' },
  { id: idOf(2), user_id: USER_ID, category: 'jeans', colors: ['navy'], status: 'donated' },
  { id: idOf(3), user_id: USER_ID, category: null, colors: [], status: 'available' },
];
const OUTFITS: Row[] = [
  {
    id: idOf(101),
    user_id: USER_ID,
    saved_at: null,
    created_at: '2026-11-01T08:00:00Z',
    items: [{ garment_id: idOf(1) }, { garment_id: idOf(2) }],
  },
];
const WEARS: Row[] = [{ id: idOf(201), user_id: USER_ID, outfit_id: idOf(101), worn_on: '2026-11-01', occasion: 'office', score: 82 }];

const FOREIGN = {
  profile: { user_id: OTHER_ID, clothing_type: 'masculine' },
  garment: { id: idOf(9), user_id: OTHER_ID, category: 'shirt', colors: ['blue'], status: 'available' },
  outfit: { id: idOf(109), user_id: OTHER_ID, saved_at: null, created_at: '2026-11-01T08:00:00Z', items: [{ garment_id: idOf(9) }] },
  wear: { id: idOf(209), user_id: OTHER_ID, outfit_id: idOf(109), worn_on: '2026-11-01', occasion: null, score: null },
};

type Tables = { profiles: Row[]; garments: Row[]; outfits: Row[]; wears: Row[] };

type World = {
  tables: Tables;
  objects: Set<string>;
  failTable?: keyof Tables;
  failSign?: boolean;
};

type Call = { url: URL; method: string; headers: Headers; body: string };

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function world(overrides: Partial<World> = {}): World {
  return {
    tables: { profiles: [PROFILE], garments: GARMENTS, outfits: OUTFITS, wears: WEARS },
    // Garment 3 has no photo yet; garment 2 has only its full-size one.
    objects: new Set([
      `${USER_ID}/${idOf(1)}/full.webp`,
      `${USER_ID}/${idOf(1)}/thumb.webp`,
      `${USER_ID}/${idOf(2)}/full.webp`,
      `${OTHER_ID}/${idOf(9)}/full.webp`,
    ]),
    ...overrides,
  };
}

const TABLES = ['profiles', 'garments', 'outfits', 'wears'] as const;

const hrefOf = (input: RequestInfo | URL): string => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

function fakeFetch(state: World): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const respond = (input: RequestInfo | URL, init?: RequestInit): Response => {
    const url = new URL(hrefOf(input));
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? init.body : '';
    calls.push({ url, method, headers, body });
    const table = TABLES.find((name) => url.pathname === `/rest/v1/${name}`);
    if (url.origin === ENV.supabaseUrl && table !== undefined && method === 'GET') {
      if (state.failTable === table) return json(500, { message: 'boom' });
      // eslint-disable-next-line security/detect-object-injection -- `table` is one of TABLES.
      const rows = state.tables[table];
      const limit = Number(url.searchParams.get('limit') ?? rows.length);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return json(200, rows.slice(offset, offset + limit));
    }
    if (url.origin === ENV.supabaseUrl && url.pathname === '/storage/v1/object/sign/garments' && method === 'POST') {
      if (state.failSign === true) return json(500, { error: 'boom' });
      const { paths } = JSON.parse(body) as { expiresIn: number; paths: string[] };
      return json(
        200,
        paths.map((path) =>
          state.objects.has(path)
            ? { path, signedURL: `/object/sign/garments/${path}?token=t-${String(path.length)}`, error: null }
            : { path, signedURL: null, error: 'Either the object does not exist or you do not have access to it' },
        ),
      );
    }
    throw new Error(`unexpected request ${method} ${url.href}`);
  };
  const fetchFn = ((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(respond(input, init))) as typeof fetch;
  return { fetch: fetchFn, calls };
}

function request(init: { method?: string; auth?: string | null } = {}): Request {
  const headers = new Headers();
  const header = init.auth === undefined ? AUTH : init.auth;
  if (header !== null) headers.set('authorization', header);
  return new Request('http://functions.test/export-data', { method: init.method ?? 'POST', headers });
}

let infoSpy: jest.SpiedFunction<typeof console.info>;

beforeEach(() => {
  infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  infoSpy.mockRestore();
});

const signed = (path: string): string => `${ENV.supabaseUrl}/storage/v1/object/sign/garments/${path}?token=t-${String(path.length)}`;

type Export = {
  exportedAt: string;
  profile: Row | null;
  garments: Row[];
  outfits: Row[];
  wears: Row[];
  photos: { garmentId: string; full: string | null; thumb: string | null }[];
};

describe('export-data', () => {
  test('answers every section: the profile, garments, outfits with items, wears and signed photo URLs', async () => {
    const { fetch: fetchFn } = fakeFetch(world());

    const response = await handleExportData(request(), { env: ENV, fetch: fetchFn, now: () => NOW });

    expect(response.status).toBe(200);
    const body = (await response.json()) as Export;
    expect(Object.keys(body).sort()).toEqual(['exportedAt', 'garments', 'outfits', 'photos', 'profile', 'wears']);
    expect(body.exportedAt).toBe('2026-11-09T12:00:00.000Z');
    expect(body.profile).toEqual(PROFILE);
    expect(body.garments).toEqual(GARMENTS);
    expect(body.outfits).toEqual(OUTFITS);
    expect(body.wears).toEqual(WEARS);
    expect(body.photos).toEqual([
      { garmentId: idOf(1), full: signed(`${USER_ID}/${idOf(1)}/full.webp`), thumb: signed(`${USER_ID}/${idOf(1)}/thumb.webp`) },
      { garmentId: idOf(2), full: signed(`${USER_ID}/${idOf(2)}/full.webp`), thumb: null },
    ]);
  });

  test('reads the rows with the caller token and signs only paths under the caller, for 7 days, with the service role', async () => {
    const { fetch: fetchFn, calls } = fakeFetch(world());

    await handleExportData(request(), { env: ENV, fetch: fetchFn, now: () => NOW });

    const reads = calls.filter(({ url }) => url.pathname.startsWith('/rest/v1/'));
    expect(reads.map(({ url }) => url.pathname).sort()).toEqual(TABLES.map((name) => `/rest/v1/${name}`).sort());
    for (const read of reads) {
      expect(read.headers.get('authorization')).toBe(AUTH);
      expect(read.headers.get('apikey')).toBe('anon-key-test');
      expect(read.url.searchParams.get('user_id')).toBe(`eq.${USER_ID}`);
    }
    const outfits = reads.find(({ url }) => url.pathname === '/rest/v1/outfits');
    expect(outfits?.url.searchParams.get('select')).toBe('*,items:outfit_items(garment_id)');

    const signs = calls.filter(({ url }) => url.pathname.startsWith('/storage/'));
    expect(signs.length).toBeGreaterThan(0);
    expect(SIGNED_URL_TTL_S).toBe(7 * 24 * 60 * 60);
    for (const sign of signs) {
      expect(sign.headers.get('authorization')).toBe('Bearer service-role-test');
      const { expiresIn, paths } = JSON.parse(sign.body) as { expiresIn: number; paths: string[] };
      expect(expiresIn).toBe(SIGNED_URL_TTL_S);
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) expect(path.startsWith(`${USER_ID}/`)).toBe(true);
    }
  });

  test('never includes another user’s rows, even if a read returned one', async () => {
    const state = world({
      tables: {
        profiles: [FOREIGN.profile, PROFILE],
        garments: [...GARMENTS, FOREIGN.garment],
        outfits: [...OUTFITS, FOREIGN.outfit],
        wears: [FOREIGN.wear, ...WEARS],
      },
    });
    const { fetch: fetchFn, calls } = fakeFetch(state);

    const response = await handleExportData(request(), { env: ENV, fetch: fetchFn, now: () => NOW });

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(OTHER_ID);
    expect(text).not.toContain(idOf(9));
    const body = JSON.parse(text) as Export;
    expect(body.profile).toEqual(PROFILE);
    expect(body.garments).toEqual(GARMENTS);
    const signedPaths = calls
      .filter(({ url }) => url.pathname.startsWith('/storage/'))
      .flatMap(({ body: sent }) => (JSON.parse(sent) as { paths: string[] }).paths);
    expect(signedPaths.some((path) => path.includes(idOf(9)))).toBe(false);
  });

  test('pages through more than 1000 rows', async () => {
    const wears = Array.from({ length: 1001 }, (_, n) => ({ ...WEARS[0], id: idOf(1000 + n) }));
    const { fetch: fetchFn, calls } = fakeFetch(world({ tables: { profiles: [PROFILE], garments: GARMENTS, outfits: OUTFITS, wears } }));

    const response = await handleExportData(request(), { env: ENV, fetch: fetchFn, now: () => NOW });

    const body = (await response.json()) as Export;
    expect(body.wears).toHaveLength(1001);
    const pages = calls.filter(({ url }) => url.pathname === '/rest/v1/wears').map(({ url }) => url.searchParams.get('offset'));
    expect(pages).toEqual(['0', '1000']);
  });

  test('answers a null profile and empty sections for a brand-new account, signing nothing', async () => {
    const { fetch: fetchFn, calls } = fakeFetch(world({ tables: { profiles: [], garments: [], outfits: [], wears: [] } }));

    const response = await handleExportData(request(), { env: ENV, fetch: fetchFn, now: () => NOW });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      exportedAt: '2026-11-09T12:00:00.000Z',
      profile: null,
      garments: [],
      outfits: [],
      wears: [],
      photos: [],
    });
    expect(calls.some(({ url }) => url.pathname.startsWith('/storage/'))).toBe(false);
  });

  test.each([['garments'], ['wears']] as const)('answers 500 when the %s read fails', async (table) => {
    const { fetch: fetchFn } = fakeFetch(world({ failTable: table }));

    const response = await handleExportData(request(), { env: ENV, fetch: fetchFn, now: () => NOW });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal' });
  });

  test('answers 500 when the photos cannot be signed, rather than an export without them', async () => {
    const { fetch: fetchFn } = fakeFetch(world({ failSign: true }));

    const response = await handleExportData(request(), { env: ENV, fetch: fetchFn, now: () => NOW });

    expect(response.status).toBe(500);
  });

  test('answers 401 without a user token and 405 for another method', async () => {
    const { fetch: fetchFn, calls } = fakeFetch(world());

    const anon = await handleExportData(request({ auth: `Bearer ${token({ role: 'anon' })}` }), { env: ENV, fetch: fetchFn });
    expect(anon.status).toBe(401);
    const get = await handleExportData(request({ method: 'GET' }), { env: ENV, fetch: fetchFn });
    expect(get.status).toBe(405);
    expect(calls).toHaveLength(0);
  });

  test('logs only an outcome word', async () => {
    const { fetch: fetchFn } = fakeFetch(world());

    await handleExportData(request(), { env: ENV, fetch: fetchFn, now: () => NOW });

    const logged = infoSpy.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
    expect(logged).toContain('exported');
    expect(logged).not.toContain(USER_ID);
    expect(logged).not.toContain('pear');
  });
});
