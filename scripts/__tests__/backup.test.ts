/** @jest-environment node */
// scripts/__tests__/backup.test.ts
/* eslint-disable security/detect-non-literal-fs-filename -- every path is under this test's own mkdtemp folder. */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  backupConfigFrom,
  type BackupConfig,
  backupDirName,
  DOWNLOAD_CONCURRENCY,
  KEEP_BACKUPS,
  LIST_PAGE,
  manifestEntry,
  redact,
  rotate,
  runBackup,
  type RunCommand,
  stalePartials,
  verifyBackup,
} from '../backup.ts';

const DB_PASSWORD = 'hunter2-db-password';
const DB_URL = `postgresql://postgres.abcdefgh:${DB_PASSWORD}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`;
const DB_URL_NO_PASSWORD = 'postgresql://postgres.abcdefgh@aws-0-eu-west-1.pooler.supabase.com:5432/postgres';
const SERVICE_KEY = 'service-role-key-never-logged';
const SUPABASE_URL = 'https://abcdefgh.supabase.co';
const NOW = new Date('2026-11-09T03:30:07.123Z');
const NAME = '2026-11-09T03-30-07Z';

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('backupDirName', () => {
  test('is the UTC time as YYYY-MM-DDTHH-mm-ssZ', () => {
    expect(backupDirName(NOW)).toBe(NAME);
  });

  test('uses UTC, not the local time zone, and pads every field', () => {
    expect(backupDirName(new Date(Date.UTC(2027, 0, 2, 4, 5, 6)))).toBe('2027-01-02T04-05-06Z');
  });
});

describe('rotate', () => {
  const day = (n: number): string => `2026-10-${String(n).padStart(2, '0')}T03-30-00Z`;

  test('returns the oldest complete backups beyond the newest `keep`', () => {
    const existing = [day(3), day(1), day(5), day(4), day(2)];

    expect(rotate(existing, 3)).toEqual([day(2), day(1)]);
  });

  test('deletes nothing while there are at most `keep` complete backups', () => {
    expect(rotate([day(1), day(2)], 2)).toEqual([]);
    expect(rotate([], 14)).toEqual([]);
  });

  test('never returns a .partial directory or a name that is not a backup', () => {
    const existing = [
      day(1),
      day(2),
      `${day(3)}.partial`,
      `${day(0)}.partial`,
      'backup.log',
      'notes',
      '2026-10-01T03-30-00',
      `x${day(4)}`,
      day(5),
    ];

    expect(rotate(existing, 1)).toEqual([day(2), day(1)]);
  });

  test('keeps 14 by default', () => {
    expect(KEEP_BACKUPS).toBe(14);
  });
});

describe('stalePartials', () => {
  test('returns the .partial folders more than `maxAgeDays` old, by their embedded time', () => {
    const now = new Date('2026-11-09T03:30:07Z');
    const names = [
      '2026-11-01T03-30-06Z.partial', // 8 days and 1 s old
      '2026-11-02T03-30-06Z.partial', // 7 days and 1 s old
      '2026-11-02T03-30-07Z.partial', // exactly 7 days old: kept
      '2026-11-02T03-30-08Z.partial', // just under 7 days: kept
      '2026-11-09T03-30-07Z.partial', // this run's time
      '2026-10-01T03-30-00Z', // a complete backup, never a partial
      'backup.log',
      'old.partial',
      '2026-02-30T03-30-00Z.partial', // not a real day
      '2026-13-45T99-99-99Z.partial', // not a real time
    ];

    expect(stalePartials(names, now, 7)).toEqual(['2026-11-01T03-30-06Z.partial', '2026-11-02T03-30-06Z.partial']);
  });

  test('returns nothing for an empty folder', () => {
    expect(stalePartials([], NOW, 7)).toEqual([]);
  });
});

describe('manifestEntry', () => {
  test('is the path, the byte size and the sha256 hex digest', () => {
    const bytes = bytesOf('hello');

    expect(manifestEntry('garments/a/b/full.webp', bytes)).toEqual({
      path: 'garments/a/b/full.webp',
      size: 5,
      sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    });
  });

  test('an empty file has size 0 and the empty digest', () => {
    expect(manifestEntry('empty', new Uint8Array())).toEqual({
      path: 'empty',
      size: 0,
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    });
  });
});

describe('redact', () => {
  test('hides every secret and any Postgres connection string', () => {
    const text = `failed: ${DB_URL} (password ${DB_PASSWORD}) key ${SERVICE_KEY} and postgres://other:pw@host/db`;

    const out = redact(text, [DB_PASSWORD, SERVICE_KEY, '']);

    expect(out).not.toContain(DB_PASSWORD);
    expect(out).not.toContain(SERVICE_KEY);
    expect(out).not.toContain('postgresql://');
    expect(out).not.toContain('postgres://');
    expect(out).toContain('failed:');
  });
});

describe('backupConfigFrom', () => {
  const home = '/Users/someone';
  const repoRoot = '/Users/someone/code/dressing-room-app';
  const env = { BACKUP_DB_URL: DB_URL, SUPABASE_URL: `${SUPABASE_URL}/`, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY };

  test('reads the env, splits the password out of the DB URL, trims the URL and defaults BACKUP_DIR', () => {
    expect(backupConfigFrom(env, home, repoRoot)).toEqual({
      dbUrl: DB_URL_NO_PASSWORD,
      dbPassword: DB_PASSWORD,
      supabaseUrl: SUPABASE_URL,
      serviceRoleKey: SERVICE_KEY,
      backupRoot: '/Users/someone/dressing-room-backups',
    });
  });

  test('percent-decodes the password and keeps the query string', () => {
    const url = 'postgresql://postgres.abcdefgh:p%40ss%2Fw%3Ard@db.example.com:5432/postgres?sslmode=require';

    expect(backupConfigFrom({ ...env, BACKUP_DB_URL: url }, home, repoRoot)).toMatchObject({
      dbUrl: 'postgresql://postgres.abcdefgh@db.example.com:5432/postgres?sslmode=require',
      dbPassword: 'p@ss/w:rd',
    });
  });

  test('a URL without a password gives an empty password', () => {
    const url = 'postgres://postgres@127.0.0.1:54322/postgres';

    expect(backupConfigFrom({ ...env, BACKUP_DB_URL: url }, home, repoRoot)).toMatchObject({ dbUrl: url, dbPassword: '' });
  });

  test('asks to percent-encode a password that is not valid percent-encoding, without echoing it', () => {
    const config = backupConfigFrom({ ...env, BACKUP_DB_URL: 'postgresql://postgres:pa%zz100%@db.example.com/postgres' }, home, repoRoot);

    expect(config).toEqual({
      error:
        "BACKUP_DB_URL's password is not valid percent-encoding: percent-encode its password's special characters (@ as %40, % as %25, / as %2F)",
    });
    expect(JSON.stringify(config)).not.toContain('pa%zz');
  });

  test('refuses a DB URL that is not a Postgres URL, without echoing it', () => {
    expect(backupConfigFrom({ ...env, BACKUP_DB_URL: 'https://user:hunter2@example.com/db' }, home, repoRoot)).toEqual({
      error: 'BACKUP_DB_URL must be a postgresql:// connection string',
    });
  });

  test('an unparseable DB URL hints at percent-encoding the password, without echoing it', () => {
    // An unencoded `/` in the password ends the host early, so `pass` becomes an invalid port.
    for (const url of ['not a url with hunter2', 'postgresql://postgres:pass/hunter2@db.example.com:5432/postgres']) {
      const config = backupConfigFrom({ ...env, BACKUP_DB_URL: url }, home, repoRoot);

      expect(config).toEqual({
        error:
          "BACKUP_DB_URL is not a valid postgresql:// connection string: percent-encode its password's special characters (@ as %40, % as %25, / as %2F)",
      });
      expect(JSON.stringify(config)).not.toContain('hunter2');
    }
  });

  test('expands a leading ~/ in BACKUP_DIR', () => {
    const config = backupConfigFrom({ ...env, BACKUP_DIR: '~/Backups/dr' }, home, repoRoot);

    expect(config).toMatchObject({ backupRoot: '/Users/someone/Backups/dr' });
  });

  test('names every missing variable, never a value', () => {
    const config = backupConfigFrom({ SUPABASE_URL: '' }, home, repoRoot);

    expect(config).toEqual({
      error: 'missing BACKUP_DB_URL, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment',
    });
  });

  test('refuses a relative BACKUP_DIR', () => {
    expect(backupConfigFrom({ ...env, BACKUP_DIR: 'backups' }, home, repoRoot)).toEqual({
      error: 'BACKUP_DIR must be an absolute path or start with ~/',
    });
  });

  test('refuses a BACKUP_DIR inside the repository', () => {
    for (const dir of [repoRoot, `${repoRoot}/backups`, `${repoRoot}/../dressing-room-app/x`]) {
      expect(backupConfigFrom({ ...env, BACKUP_DIR: dir }, home, repoRoot)).toEqual({
        error: 'BACKUP_DIR must be outside the repository: backups hold personal data',
      });
    }
  });

  test('refuses a BACKUP_DIR that is the home folder or the filesystem root, which the run would make private', () => {
    for (const dir of ['~', '~/', home, `${home}/`, `${home}/code/..`, '/', '/Users/..']) {
      expect(backupConfigFrom({ ...env, BACKUP_DIR: dir }, home, repoRoot)).toEqual({
        error: 'BACKUP_DIR must be a folder of its own, not the home folder or the filesystem root: the run makes it private',
      });
    }
  });

  test('accepts a sibling folder whose name only starts like the repository', () => {
    const config = backupConfigFrom({ ...env, BACKUP_DIR: `${repoRoot}-backups` }, home, repoRoot);

    expect(config).toMatchObject({ backupRoot: `${repoRoot}-backups` });
  });
});

// --- runBackup, driven by fakes ------------------------------------------------------------------

type Call = { command: string; args: readonly string[]; env: Readonly<Record<string, string>> };

/** A `pnpm exec supabase db dump` fake that writes `-f`'s file, unless `failWhen` matches the call. */
function fakeRun(calls: Call[], failWhen: (args: readonly string[]) => boolean = () => false): RunCommand {
  return async (command, args, env) => {
    calls.push({ command, args, env });
    if (failWhen(args)) {
      return { code: 1, stderr: `pg_dump: error: connection to ${DB_URL} failed: password ${DB_PASSWORD} rejected` };
    }
    const file = args[args.indexOf('-f') + 1];
    if (file === undefined) throw new Error('no -f');
    await writeFile(file, args.includes('--data-only') ? 'COPY data;\n' : 'CREATE TABLE schema;\n');
    return { code: 0, stderr: '' };
  };
}

type FetchOptions = {
  /** Object path → bytes in the fake `garments` bucket. */
  objects: ReadonlyMap<string, Uint8Array>;
  /** The status for this object's download instead of 200. */
  failDownload?: { path: string; status: number };
  /** The status for every list call instead of 200 (an expired key). */
  listStatus?: number;
  /** Extra names returned at the bucket's top level. */
  extraTopLevel?: readonly { name: string; id: string | null }[];
  /** The most entries one list page returns, whatever `limit` asks (a server with a smaller cap). */
  pageCap?: number;
};

/** A fake Storage API over `objects`: the one-level list (folders with a null id) and downloads. */
function fakeFetch(options: FetchOptions, requests: { url: string; auth: string | null }[]): typeof fetch {
  const listPrefix = `${SUPABASE_URL}/storage/v1/object/list/garments`;
  const downloadPrefix = `${SUPABASE_URL}/storage/v1/object/garments/`;
  const handle = (input: string | URL | Request, init?: RequestInit): Response => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    requests.push({ url, auth: headers.get('authorization') });
    if (headers.get('authorization') !== `Bearer ${SERVICE_KEY}`) return new Response('{}', { status: 401 });
    if (url === listPrefix && init?.method === 'POST') {
      if (options.listStatus !== undefined) return new Response('{"message":"jwt expired"}', { status: options.listStatus });
      const body = JSON.parse(typeof init.body === 'string' ? init.body : '') as { prefix: string; limit: number; offset: number };
      const children = new Map<string, string | null>();
      for (const path of options.objects.keys()) {
        if (!path.startsWith(body.prefix)) continue;
        const [name = '', ...rest] = path.slice(body.prefix.length).split('/');
        children.set(name, rest.length > 0 ? null : `id-${path}`);
      }
      const entries = [...children.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, id]) => ({ name, id }));
      if (body.prefix === '') entries.push(...(options.extraTopLevel ?? []));
      return Response.json(entries.slice(body.offset, body.offset + Math.min(body.limit, options.pageCap ?? body.limit)));
    }
    if (url.startsWith(downloadPrefix) && (init?.method ?? 'GET') === 'GET') {
      const path = url.slice(downloadPrefix.length).split('/').map(decodeURIComponent).join('/');
      if (options.failDownload?.path === path) return new Response('boom', { status: options.failDownload.status });
      const bytes = options.objects.get(path);
      if (bytes === undefined) return new Response('{"statusCode":"404"}', { status: 400 });
      return new Response(new Uint8Array(bytes), { status: 200 });
    }
    return new Response('unexpected', { status: 500 });
  };
  return (input, init) => Promise.resolve(handle(input, init));
}

const OBJECTS = new Map<string, Uint8Array>([
  ['11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/full.webp', bytesOf('full-1')],
  ['11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/thumb.webp', bytesOf('thumb-1')],
  ['22222222-2222-4222-8222-222222222222/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/full.webp', bytesOf('full-2')],
]);

/** 15 complete backups from October, oldest first, plus a 4-day-old .partial and a log file. */
const OLD_BACKUPS = Array.from({ length: 15 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}T03-30-00Z`);
const RECENT_PARTIAL = '2026-11-05T03-30-00Z.partial';

let root: string;
let logs: string[];
let config: BackupConfig;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'backup-'));
  for (const name of [...OLD_BACKUPS, RECENT_PARTIAL]) await mkdir(join(root, name));
  await writeFile(join(root, 'backup.log'), 'old log\n');
  logs = [];
  config = {
    dbUrl: DB_URL_NO_PASSWORD,
    dbPassword: DB_PASSWORD,
    supabaseUrl: SUPABASE_URL,
    serviceRoleKey: SERVICE_KEY,
    backupRoot: root,
  };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const log = (line: string): void => {
  logs.push(line);
};

/** Every log line must be free of the DB URL, its password and the service-role key. */
function expectNoSecretsLogged(): void {
  const all = logs.join('\n');
  expect(all).not.toContain(DB_PASSWORD);
  expect(all).not.toContain(SERVICE_KEY);
  expect(all).not.toContain('postgresql://');
}

/** The failed run left its `.partial` directory, made no complete backup, and rotated nothing. */
async function expectFailedRunLeftOnlyPartial(): Promise<void> {
  const names = (await readdir(root)).sort();
  expect(names).toEqual([...OLD_BACKUPS, RECENT_PARTIAL, `${NAME}.partial`, 'backup.log'].sort());
}

test('a complete run writes the dumps, every object and the manifest, renames the .partial and keeps the newest 14', async () => {
  const calls: Call[] = [];
  const requests: { url: string; auth: string | null }[] = [];

  const code = await runBackup({
    config,
    now: NOW,
    run: fakeRun(calls),
    fetch: fakeFetch({ objects: OBJECTS }, requests),
    log,
  });

  expect(code).toBe(0);
  const dir = join(root, NAME);
  // The two dumps, through the repo's own Supabase CLI, with the password in the env only.
  expect(calls).toEqual([
    {
      command: 'pnpm',
      args: ['exec', 'supabase', 'db', 'dump', '--db-url', DB_URL_NO_PASSWORD, '-f', join(`${dir}.partial`, 'schema.sql')],
      env: { PGPASSWORD: DB_PASSWORD },
    },
    {
      command: 'pnpm',
      args: [
        'exec',
        'supabase',
        'db',
        'dump',
        '--db-url',
        DB_URL_NO_PASSWORD,
        '--data-only',
        '--use-copy',
        '-x',
        'storage.buckets,storage.buckets_vectors,storage.vector_indexes,net.http_request_queue,net._http_response',
        '-f',
        join(`${dir}.partial`, 'data.sql'),
      ],
      env: { PGPASSWORD: DB_PASSWORD },
    },
  ]);
  // Every Storage call carries the service-role key.
  expect(requests.every((request) => request.auth === `Bearer ${SERVICE_KEY}`)).toBe(true);
  for (const [path, bytes] of OBJECTS) {
    expect(new Uint8Array(await readFile(join(dir, 'garments', path)))).toEqual(bytes);
  }
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as {
    createdAt: string;
    files: { path: string; size: number; sha256: string }[];
  };
  expect(manifest.createdAt).toBe(NOW.toISOString());
  expect(manifest.files).toEqual([
    manifestEntry('schema.sql', bytesOf('CREATE TABLE schema;\n')),
    manifestEntry('data.sql', bytesOf('COPY data;\n')),
    ...[...OBJECTS].map(([path, bytes]) => ({ path: `garments/${path}`, size: bytes.length, sha256: sha256(bytes) })),
  ]);
  // 15 old + this one = 16 complete: the two oldest go; the recent .partial and the log stay.
  const names = (await readdir(root)).sort();
  expect(names).toEqual([...OLD_BACKUPS.slice(2), NAME, RECENT_PARTIAL, 'backup.log'].sort());
  expect(logs).toContain('backup: newest complete backup is 2026-10-15T03-30-00Z, 25.0 days old');
  expectNoSecretsLogged();
});

test('every file of a backup is owner-only (0600) and every folder 0700', async () => {
  const code = await runBackup({ config, now: NOW, run: fakeRun([]), fetch: fakeFetch({ objects: OBJECTS }, []), log });

  expect(code).toBe(0);
  const modes = new Map<string, number>();
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      modes.set(path, (await stat(path)).mode & 0o777);
      if (entry.isDirectory()) await walk(path);
    }
  };
  await walk(join(root, NAME));
  // schema.sql, data.sql, manifest.json and 3 photos; garments/, 2 user folders and 2 garment folders.
  expect(modes.size).toBe(11);
  for (const [path, mode] of modes) {
    expect({ path, mode }).toEqual({ path, mode: (await stat(path)).isDirectory() ? 0o700 : 0o600 });
  }
  expect((await stat(root)).mode & 0o777).toBe(0o700);
  expect((await stat(join(root, NAME))).mode & 0o777).toBe(0o700);
});

test('an existing backup root is tightened to 0700', async () => {
  const loose = join(root, 'loose');
  await mkdir(loose, { mode: 0o755 });

  const code = await runBackup({
    config: { ...config, backupRoot: loose },
    now: NOW,
    run: fakeRun([]),
    fetch: fakeFetch({ objects: OBJECTS }, []),
    log,
  });

  expect(code).toBe(0);
  expect((await stat(loose)).mode & 0o777).toBe(0o700);
  expect(logs).toContain('backup: no complete backup yet');
});

test('deletes .partial folders older than 7 days at the start of every run, even one that then fails', async () => {
  const stale = '2026-10-31T03-30-00Z.partial';
  await mkdir(join(root, stale));
  await writeFile(join(root, stale, 'data.sql'), 'COPY data;\n');

  const code = await runBackup({
    config,
    now: NOW,
    run: fakeRun([], () => true),
    fetch: fakeFetch({ objects: OBJECTS }, []),
    log,
  });

  expect(code).not.toBe(0);
  await expectFailedRunLeftOnlyPartial();
  expect(logs).toContain('backup: deleted 1 stale .partial folder');
  // The age of the newest good backup shows in a failed run's log too.
  expect(logs).toContain('backup: newest complete backup is 2026-10-15T03-30-00Z, 25.0 days old');
});

test('no spawned command line carries the database password, decoded or percent-encoded', async () => {
  const password = 'p@ss/w:rd hunter2';
  const url = `postgresql://postgres.abcdefgh:${encodeURIComponent(password)}@db.example.com:5432/postgres`;
  const parsed = backupConfigFrom(
    { BACKUP_DB_URL: url, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, BACKUP_DIR: root },
    '/Users/someone',
    '/Users/someone/code/dressing-room-app',
  );
  if ('error' in parsed) throw new Error(parsed.error);
  const calls: Call[] = [];

  const code = await runBackup({ config: parsed, now: NOW, run: fakeRun(calls), fetch: fakeFetch({ objects: OBJECTS }, []), log });

  expect(code).toBe(0);
  expect(calls).toHaveLength(2);
  for (const call of calls) {
    const argv = [call.command, ...call.args].join(' ');
    expect(argv).not.toContain(password);
    expect(argv).not.toContain(encodeURIComponent(password));
    expect(argv).not.toContain('hunter2');
    expect(call.env).toEqual({ PGPASSWORD: password });
  }
});

test('an empty bucket still makes a complete backup with only the dumps in the manifest', async () => {
  const code = await runBackup({ config, now: NOW, run: fakeRun([]), fetch: fakeFetch({ objects: new Map() }, []), log });

  expect(code).toBe(0);
  const manifest = JSON.parse(await readFile(join(root, NAME, 'manifest.json'), 'utf8')) as { files: { path: string }[] };
  expect(manifest.files.map((file) => file.path)).toEqual(['schema.sql', 'data.sql']);
});

test('lists past a full page of objects', async () => {
  const user = '33333333-3333-4333-8333-333333333333';
  const many = new Map(
    Array.from({ length: LIST_PAGE + 1 }, (_, i) => [`${user}/${String(i).padStart(5, '0')}.webp`, bytesOf(String(i))]),
  );

  const code = await runBackup({ config, now: NOW, run: fakeRun([]), fetch: fakeFetch({ objects: many }, []), log });

  expect(code).toBe(0);
  expect(await readdir(join(root, NAME, 'garments', user))).toHaveLength(LIST_PAGE + 1);
});

test('keeps paging until an empty page, also when the server caps pages below the limit', async () => {
  const user = '44444444-4444-4444-8444-444444444444';
  const five = new Map(Array.from({ length: 5 }, (_, i) => [`${user}/${String(i)}.webp`, bytesOf(String(i))]));

  const code = await runBackup({ config, now: NOW, run: fakeRun([]), fetch: fakeFetch({ objects: five, pageCap: 2 }, []), log });

  expect(code).toBe(0);
  expect((await readdir(join(root, NAME, 'garments', user))).sort()).toEqual(['0.webp', '1.webp', '2.webp', '3.webp', '4.webp']);
});

test('starts no new download after the first one fails', async () => {
  const user = '55555555-5555-4555-8555-555555555555';
  const many = new Map(Array.from({ length: 20 }, (_, i) => [`${user}/${String(i).padStart(2, '0')}.webp`, bytesOf(String(i))]));
  const requests: { url: string; auth: string | null }[] = [];

  const code = await runBackup({
    config,
    now: NOW,
    run: fakeRun([]),
    fetch: fakeFetch({ objects: many, failDownload: { path: `${user}/00.webp`, status: 500 } }, requests),
    log,
  });

  expect(code).not.toBe(0);
  const downloads = requests.filter((request) => request.url.startsWith(`${SUPABASE_URL}/storage/v1/object/garments/`));
  // Only the ones already in flight when the first failed: at most one per worker.
  expect(downloads.length).toBeLessThanOrEqual(DOWNLOAD_CONCURRENCY);
  expect(downloads.length).toBeLessThan(many.size);
});

describe('verifyBackup', () => {
  async function completeBackup(): Promise<string> {
    const code = await runBackup({ config, now: NOW, run: fakeRun([]), fetch: fakeFetch({ objects: OBJECTS }, []), log });
    expect(code).toBe(0);
    return join(root, NAME);
  }
  const [firstPhoto = ''] = OBJECTS.keys();

  test('a complete backup verifies', async () => {
    expect(await verifyBackup(await completeBackup())).toEqual({ files: 5, problems: [] });
  });

  test('names a changed file and a missing one', async () => {
    const dir = await completeBackup();
    await writeFile(join(dir, 'garments', firstPhoto), 'tampered');
    await unlink(join(dir, 'data.sql'));

    expect(await verifyBackup(dir)).toEqual({
      files: 5,
      problems: ['data.sql: missing', `garments/${firstPhoto}: size or sha256 differs`],
    });
  });

  test('refuses a manifest path that would leave the backup folder', async () => {
    const dir = await completeBackup();
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ files: [{ path: '../outside', size: 0, sha256: '' }] }));

    expect(await verifyBackup(dir)).toEqual({ files: 1, problems: ['../outside: unsafe path'] });
  });

  test('a missing or malformed manifest is one problem', async () => {
    const dir = await completeBackup();
    await writeFile(join(dir, 'manifest.json'), '{"files": "nope"}');

    expect(await verifyBackup(dir)).toEqual({ files: 0, problems: ['manifest.json is missing or malformed'] });
    expect(await verifyBackup(join(root, 'no-such-backup'))).toEqual({ files: 0, problems: ['manifest.json is missing or malformed'] });
  });
});

describe('a run that fails halfway exits non-zero, leaves only its .partial and rotates nothing', () => {
  test('the schema dump fails (a wrong database URL)', async () => {
    const calls: Call[] = [];

    const code = await runBackup({
      config,
      now: NOW,
      run: fakeRun(calls, (args) => !args.includes('--data-only')),
      fetch: fakeFetch({ objects: OBJECTS }, []),
      log,
    });

    expect(code).not.toBe(0);
    expect(calls).toHaveLength(1);
    await expectFailedRunLeftOnlyPartial();
    expect(logs.join('\n')).toMatch(/schema dump failed/);
    expectNoSecretsLogged();
  });

  test('the data dump fails', async () => {
    const code = await runBackup({
      config,
      now: NOW,
      run: fakeRun([], (args) => args.includes('--data-only')),
      fetch: fakeFetch({ objects: OBJECTS }, []),
      log,
    });

    expect(code).not.toBe(0);
    await expectFailedRunLeftOnlyPartial();
    expect(logs.join('\n')).toMatch(/data dump failed/);
    expectNoSecretsLogged();
  });

  test('the storage list is refused (an expired key)', async () => {
    const code = await runBackup({
      config,
      now: NOW,
      run: fakeRun([]),
      fetch: fakeFetch({ objects: OBJECTS, listStatus: 401 }, []),
      log,
    });

    expect(code).not.toBe(0);
    await expectFailedRunLeftOnlyPartial();
    expect(logs.join('\n')).toMatch(/storage list failed: HTTP 401/);
    expectNoSecretsLogged();
  });

  test('one object download errors', async () => {
    const [failing = ''] = OBJECTS.keys();

    const code = await runBackup({
      config,
      now: NOW,
      run: fakeRun([]),
      fetch: fakeFetch({ objects: OBJECTS, failDownload: { path: failing, status: 500 } }, []),
      log,
    });

    expect(code).not.toBe(0);
    await expectFailedRunLeftOnlyPartial();
    expect(logs.join('\n')).toMatch(/storage download failed: HTTP 500/);
    expectNoSecretsLogged();
  });

  test('an object listed but gone by download time (a 404) fails the run too', async () => {
    const [failing = ''] = OBJECTS.keys();

    const code = await runBackup({
      config,
      now: NOW,
      run: fakeRun([]),
      fetch: fakeFetch({ objects: OBJECTS, failDownload: { path: failing, status: 404 } }, []),
      log,
    });

    expect(code).not.toBe(0);
    await expectFailedRunLeftOnlyPartial();
  });

  test('fetch itself throws (offline)', async () => {
    const offline = (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch;

    const code = await runBackup({ config, now: NOW, run: fakeRun([]), fetch: offline, log });

    expect(code).not.toBe(0);
    await expectFailedRunLeftOnlyPartial();
    expect(logs.join('\n')).toMatch(/fetch failed/);
  });

  test('the list returns a name that would escape the backup folder', async () => {
    const code = await runBackup({
      config,
      now: NOW,
      run: fakeRun([]),
      fetch: fakeFetch({ objects: OBJECTS, extraTopLevel: [{ name: '..', id: null }] }, []),
      log,
    });

    expect(code).not.toBe(0);
    await expectFailedRunLeftOnlyPartial();
    expect(logs.join('\n')).toMatch(/unexpected entry/);
  });

  test('the command runner itself throws (pnpm not on PATH)', async () => {
    const missing: RunCommand = () => Promise.reject(new Error('spawn pnpm ENOENT'));

    const code = await runBackup({ config, now: NOW, run: missing, fetch: fakeFetch({ objects: OBJECTS }, []), log });

    expect(code).not.toBe(0);
    await expectFailedRunLeftOnlyPartial();
    expect(logs.join('\n')).toMatch(/spawn pnpm ENOENT/);
  });
});

test('a second run in the same second refuses to reuse an existing .partial', async () => {
  await mkdir(join(root, `${NAME}.partial`));
  const calls: Call[] = [];

  const code = await runBackup({ config, now: NOW, run: fakeRun(calls), fetch: fakeFetch({ objects: OBJECTS }, []), log });

  expect(code).not.toBe(0);
  expect(calls).toEqual([]);
  expect(await readdir(root)).toHaveLength(OLD_BACKUPS.length + 3);
});

test('creates a missing backup root (owner-only)', async () => {
  const nested = join(root, 'nested', 'backups');

  const code = await runBackup({
    config: { ...config, backupRoot: nested },
    now: NOW,
    run: fakeRun([]),
    fetch: fakeFetch({ objects: OBJECTS }, []),
    log,
  });

  expect(code).toBe(0);
  expect(await readdir(nested)).toEqual([NAME]);
  expect((await stat(nested)).mode & 0o777).toBe(0o700);
  expect((await stat(join(nested, NAME))).mode & 0o777).toBe(0o700);
});
