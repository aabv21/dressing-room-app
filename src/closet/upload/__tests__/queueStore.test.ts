import type { QueueItem } from '../queueStore';

// `queueStore.ts` opens its SQLite database and creates its table at import time, so every test
// mocks expo-sqlite/expo-file-system/expo-crypto first and re-imports the module fresh (same
// pattern as `cutout.test.ts`).

type Row = Record<string, string | number | null>;

/** A tiny in-memory stand-in for expo-sqlite's synchronous API, enough for one fixed-shape table. */
function createFakeDatabase(): {
  execSync: jest.Mock;
  runSync: jest.Mock;
  getAllSync: jest.Mock;
  getFirstSync: jest.Mock;
  rows: Map<string, Row>;
} {
  const rows = new Map<string, Row>();

  const execSync = jest.fn();

  const runSync = jest.fn((source: string, params: readonly (string | number | null)[]) => {
    if (source.startsWith('INSERT INTO upload_queue')) {
      const [
        garmentId,
        userId,
        replace,
        sourceUri,
        stage,
        fullUri,
        thumbUri,
        attempts,
        nextAttemptAt,
        failed,
        createdAt,
      ] = params;
      rows.set(garmentId as string, {
        garment_id: garmentId as string,
        user_id: userId as string,
        replace: replace as number,
        source_uri: sourceUri as string,
        stage: stage as string,
        full_uri: fullUri as string | null,
        thumb_uri: thumbUri as string | null,
        attempts: attempts as number,
        next_attempt_at: nextAttemptAt as number,
        failed: failed as number,
        created_at: createdAt as number,
      });
      return { changes: 1, lastInsertRowId: 0 };
    }
    if (source.startsWith('UPDATE upload_queue SET') && source.includes('"replace" = ?')) {
      // saveItem: conditional on garment_id AND source_uri, so a stale snapshot from a worker
      // that lost a replacement race affects zero rows instead of clobbering the new one.
      const [userId, replace, stage, fullUri, thumbUri, attempts, nextAttemptAt, failed, createdAt, garmentId, sourceUri] =
        params;
      const row = rows.get(garmentId as string);
      if (row === undefined || row['source_uri'] !== sourceUri) {
        return { changes: 0, lastInsertRowId: 0 };
      }
      row['user_id'] = userId as string;
      row['replace'] = replace as number;
      row['stage'] = stage as string;
      row['full_uri'] = fullUri as string | null;
      row['thumb_uri'] = thumbUri as string | null;
      row['attempts'] = attempts as number;
      row['next_attempt_at'] = nextAttemptAt as number;
      row['failed'] = failed as number;
      row['created_at'] = createdAt as number;
      return { changes: 1, lastInsertRowId: 0 };
    }
    if (source.startsWith('DELETE FROM upload_queue WHERE garment_id = ? AND source_uri')) {
      const [garmentId, sourceUri] = params;
      const row = rows.get(garmentId as string);
      if (row === undefined || row['source_uri'] !== sourceUri) {
        return { changes: 0, lastInsertRowId: 0 };
      }
      rows.delete(garmentId as string);
      return { changes: 1, lastInsertRowId: 0 };
    }
    if (source.startsWith('UPDATE upload_queue SET failed')) {
      const [userId] = params;
      let changes = 0;
      for (const row of rows.values()) {
        if (row['user_id'] === userId) {
          row['failed'] = 0;
          row['attempts'] = 0;
          row['next_attempt_at'] = 0;
          changes += 1;
        }
      }
      return { changes, lastInsertRowId: 0 };
    }
    throw new Error(`fake database: unhandled runSync source: ${source}`);
  });

  const getAllSync = jest.fn((source: string, params: readonly (string | number | null)[]) => {
    if (source.startsWith('SELECT * FROM upload_queue WHERE user_id')) {
      const [userId] = params;
      return [...rows.values()]
        .filter((row) => row['user_id'] === userId)
        .sort((a, b) => (a['created_at'] as number) - (b['created_at'] as number));
    }
    throw new Error(`fake database: unhandled getAllSync source: ${source}`);
  });

  const getFirstSync = jest.fn((source: string, params: readonly (string | number | null)[]) => {
    if (source.startsWith('SELECT * FROM upload_queue WHERE garment_id')) {
      const [garmentId] = params;
      return rows.get(garmentId as string) ?? null;
    }
    throw new Error(`fake database: unhandled getFirstSync source: ${source}`);
  });

  return { execSync, runSync, getAllSync, getFirstSync, rows };
}

type FakeFile = {
  uri: string;
  exists: boolean;
};

// Named with a `mock` prefix so jest.mock()'s module factory (below) is allowed to close over it.
/** Tracks every file the fake filesystem knows about, keyed by `file://` URI. */
const mockFiles = new Map<string, FakeFile>();

// Tracks every directory the fake filesystem has created, so a second `create()` call on the same
// path reproduces expo-file-system 58's real behavior: it throws unless `idempotent: true` (see
// the C1 fix in queueStore.ts's `copyIntoUploads`, and the "already exists" tests below).
const mockDirectories = new Set<string>();

function registerSourceFile(uri: string): void {
  mockFiles.set(uri, { uri, exists: true });
}

jest.mock('expo-file-system', () => {
  class FakeFile {
    uri: string;
    constructor(...parts: unknown[]) {
      const first = parts[0];
      if (typeof first === 'object' && first !== null && 'uri' in first) {
        const base = (first as { uri: string }).uri;
        const rest = parts.slice(1) as string[];
        this.uri = [base, ...rest].join('/');
      } else {
        this.uri = parts.join('/');
      }
    }
    get exists(): boolean {
      return mockFiles.get(this.uri)?.exists ?? false;
    }
    copySync(destination: FakeFile): void {
      const source = mockFiles.get(this.uri);
      if (source === undefined || !source.exists) {
        throw new Error(`fake file-system: copySync source missing: ${this.uri}`);
      }
      mockFiles.set(destination.uri, { uri: destination.uri, exists: true });
    }
    delete(): void {
      const entry = mockFiles.get(this.uri);
      if (entry === undefined || !entry.exists) {
        throw new Error(`fake file-system: delete on missing file: ${this.uri}`);
      }
      mockFiles.delete(this.uri);
    }
  }

  class FakeDirectory {
    uri: string;
    constructor(...parts: unknown[]) {
      const first = parts[0];
      if (typeof first === 'object' && first !== null && 'uri' in first) {
        const base = (first as { uri: string }).uri;
        const rest = parts.slice(1) as string[];
        this.uri = [base, ...rest].join('/');
      } else {
        this.uri = parts.join('/');
      }
    }
    create(options?: { idempotent?: boolean }): void {
      if (mockDirectories.has(this.uri) && options?.idempotent !== true) {
        throw new Error(`fake file-system: directory already exists: ${this.uri}`);
      }
      mockDirectories.add(this.uri);
    }
  }

  return {
    File: FakeFile,
    Directory: FakeDirectory,
    Paths: {
      document: { uri: 'file:///document' },
      extname: (path: string) => {
        const match = /\.[^./]+$/.exec(path);
        return match ? match[0] : '';
      },
    },
  };
});

let mockNextUuid = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => {
    mockNextUuid += 1;
    return `uuid-${String(mockNextUuid)}`;
  }),
}));

let mockDb: ReturnType<typeof createFakeDatabase>;
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn(() => mockDb),
}));

async function loadQueueStore(): Promise<typeof import('../queueStore')> {
  jest.resetModules();
  mockDb = createFakeDatabase();
  mockFiles.clear();
  mockDirectories.clear();
  mockNextUuid = 0;
  return import('../queueStore');
}

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(1_700_000_000_000);
});

afterEach(() => {
  jest.useRealTimers();
});

test('enqueuePhotos returns items in order, captured, copied under uploads/', async () => {
  const { enqueuePhotos, listQueue } = await loadQueueStore();
  registerSourceFile('file:///cache/a.jpg');
  registerSourceFile('file:///cache/b.heic');

  const enqueued = enqueuePhotos('user-1', ['file:///cache/a.jpg', 'file:///cache/b.heic']);

  expect(enqueued).toHaveLength(2);
  const listed = listQueue('user-1');
  expect(listed).toHaveLength(2);
  expect(listed.map((item) => item.garmentId)).toEqual(enqueued.map((item) => item.garmentId));
  for (const item of listed) {
    expect(item.stage).toBe('captured');
    expect(item.userId).toBe('user-1');
    expect(item.replace).toBe(false);
    expect(item.sourceUri).toContain('/uploads/');
    expect(item.sourceUri).toContain(item.garmentId);
  }
});

test('enqueuing a second batch does not fail on the already-created uploads/ directory', async () => {
  // C1 regression: expo-file-system's Directory.create() throws "already exists" on a second
  // call unless `idempotent: true` — the fake Directory above reproduces that, so this would have
  // failed before copyIntoUploads passed `idempotent: true` instead of `overwrite: false`.
  const { enqueuePhotos, listQueue } = await loadQueueStore();
  registerSourceFile('file:///cache/a.jpg');
  registerSourceFile('file:///cache/b.jpg');

  enqueuePhotos('user-1', ['file:///cache/a.jpg']);
  expect(() => {
    enqueuePhotos('user-1', ['file:///cache/b.jpg']);
  }).not.toThrow();

  expect(listQueue('user-1')).toHaveLength(2);
});

test('enqueueReplacement sets replace to true', async () => {
  const { enqueueReplacement, listQueue } = await loadQueueStore();
  registerSourceFile('file:///cache/replace.jpg');

  const item = enqueueReplacement('user-1', 'garment-42', 'file:///cache/replace.jpg');

  expect(item.replace).toBe(true);
  expect(item.garmentId).toBe('garment-42');
  const [listed] = listQueue('user-1');
  expect(listed?.replace).toBe(true);
});

test('enqueueReplacement deletes the old row files when nothing was running (captured)', async () => {
  const { enqueuePhotos, enqueueReplacement } = await loadQueueStore();
  registerSourceFile('file:///cache/a.jpg');
  const [first] = enqueuePhotos('user-1', ['file:///cache/a.jpg']) as [QueueItem];

  registerSourceFile('file:///cache/a2.jpg');
  enqueueReplacement('user-1', first.garmentId, 'file:///cache/a2.jpg');

  expect(mockFiles.has(first.sourceUri)).toBe(false);
});

test('enqueueReplacement deletes the old row files when it had already failed', async () => {
  const { enqueuePhotos, enqueueReplacement, saveItem } = await loadQueueStore();
  registerSourceFile('file:///cache/a.jpg');
  const [first] = enqueuePhotos('user-1', ['file:///cache/a.jpg']) as [QueueItem];
  saveItem({ ...first, stage: 'uploaded', failed: true, attempts: 8 });

  registerSourceFile('file:///cache/a2.jpg');
  enqueueReplacement('user-1', first.garmentId, 'file:///cache/a2.jpg');

  expect(mockFiles.has(first.sourceUri)).toBe(false);
});

test('enqueueReplacement leaves the old row files for a run that is still in progress', async () => {
  // I1: an item whose worker may still be mid-run (not failed, past 'captured') keeps its files —
  // the worker's own saveItem/removeItem (keyed by source_uri) clean them up once it finishes.
  const { enqueuePhotos, enqueueReplacement, saveItem } = await loadQueueStore();
  registerSourceFile('file:///cache/a.jpg');
  const [first] = enqueuePhotos('user-1', ['file:///cache/a.jpg']) as [QueueItem];
  const uploaded: QueueItem = {
    ...first,
    stage: 'uploaded',
    fullUri: 'file:///document/uploads/full.webp',
    thumbUri: 'file:///document/uploads/thumb.webp',
  };
  registerSourceFile(uploaded.fullUri as string);
  registerSourceFile(uploaded.thumbUri as string);
  saveItem(uploaded);

  registerSourceFile('file:///cache/a2.jpg');
  enqueueReplacement('user-1', first.garmentId, 'file:///cache/a2.jpg');

  expect(mockFiles.has(uploaded.sourceUri)).toBe(true);
  expect(mockFiles.has(uploaded.fullUri as string)).toBe(true);
  expect(mockFiles.has(uploaded.thumbUri as string)).toBe(true);
});

test('saveItem no-ops when the row has moved on to a different source_uri', async () => {
  // I1: a worker holding a stale snapshot (pre-replacement) must not clobber the replacement row.
  const { enqueuePhotos, enqueueReplacement, saveItem, listQueue } = await loadQueueStore();
  registerSourceFile('file:///cache/a.jpg');
  const [stale] = enqueuePhotos('user-1', ['file:///cache/a.jpg']) as [QueueItem];

  registerSourceFile('file:///cache/a2.jpg');
  const replacement = enqueueReplacement('user-1', stale.garmentId, 'file:///cache/a2.jpg');

  saveItem({ ...stale, stage: 'prepared', fullUri: 'file:///document/uploads/full.webp', thumbUri: 'file:///document/uploads/thumb.webp' });

  const [listed] = listQueue('user-1');
  expect(listed?.sourceUri).toBe(replacement.sourceUri);
  expect(listed?.stage).toBe('captured');
});

test('removeItem no-ops (and deletes nothing) when the row has moved on to a different source_uri', async () => {
  // I1: a worker finishing a run it started before a replacement landed must not delete the
  // replacement's row or files — only its own (already-renamed-away) source_uri still matches.
  const { enqueuePhotos, enqueueReplacement, removeItem, listQueue } = await loadQueueStore();
  registerSourceFile('file:///cache/a.jpg');
  const [stale] = enqueuePhotos('user-1', ['file:///cache/a.jpg']) as [QueueItem];

  registerSourceFile('file:///cache/a2.jpg');
  const replacement = enqueueReplacement('user-1', stale.garmentId, 'file:///cache/a2.jpg');

  removeItem(stale);

  const [listed] = listQueue('user-1');
  expect(listed?.garmentId).toBe(replacement.garmentId);
  expect(listed?.sourceUri).toBe(replacement.sourceUri);
  expect(mockFiles.has(replacement.sourceUri)).toBe(true);
});

test('removeItem deletes the row and its files', async () => {
  const { enqueuePhotos, listQueue, removeItem, saveItem } = await loadQueueStore();
  registerSourceFile('file:///cache/a.jpg');

  const [queued] = enqueuePhotos('user-1', ['file:///cache/a.jpg']) as [QueueItem];
  const withFiles: QueueItem = {
    ...queued,
    fullUri: 'file:///document/uploads/full.webp',
    thumbUri: 'file:///document/uploads/thumb.webp',
  };
  registerSourceFile(withFiles.fullUri as string);
  registerSourceFile(withFiles.thumbUri as string);
  saveItem(withFiles);

  removeItem(withFiles);

  expect(listQueue('user-1')).toHaveLength(0);
  expect(mockFiles.has(queued.sourceUri)).toBe(false);
  expect(mockFiles.has(withFiles.fullUri as string)).toBe(false);
  expect(mockFiles.has(withFiles.thumbUri as string)).toBe(false);
});

test('removeItem ignores files that are already gone', async () => {
  const { enqueuePhotos, removeItem, listQueue } = await loadQueueStore();
  registerSourceFile('file:///cache/a.jpg');

  const [queued] = enqueuePhotos('user-1', ['file:///cache/a.jpg']) as [QueueItem];
  mockFiles.delete(queued.sourceUri);

  expect(() => {
    removeItem(queued);
  }).not.toThrow();
  expect(listQueue('user-1')).toHaveLength(0);
});

test('clearQueue removes every row and copied file of one user, and only that user', async () => {
  const { enqueuePhotos, listQueue, clearQueue } = await loadQueueStore();
  registerSourceFile('file:///cache/a.jpg');
  registerSourceFile('file:///cache/b.jpg');
  registerSourceFile('file:///cache/c.jpg');

  const mine = enqueuePhotos('user-1', ['file:///cache/a.jpg', 'file:///cache/b.jpg']);
  const [theirs] = enqueuePhotos('user-2', ['file:///cache/c.jpg']) as [QueueItem];

  clearQueue('user-1');

  expect(listQueue('user-1')).toHaveLength(0);
  for (const item of mine) {
    expect(mockFiles.has(item.sourceUri)).toBe(false);
  }
  expect(listQueue('user-2')).toEqual([theirs]);
  expect(mockFiles.has(theirs.sourceUri)).toBe(true);
});

test('resetFailed clears failure, attempts and backoff', async () => {
  const { enqueuePhotos, saveItem, resetFailed, listQueue } = await loadQueueStore();
  registerSourceFile('file:///cache/a.jpg');

  const [queued] = enqueuePhotos('user-1', ['file:///cache/a.jpg']) as [QueueItem];
  saveItem({ ...queued, failed: true, attempts: 5, nextAttemptAt: 123456 });

  resetFailed('user-1');

  const [listed] = listQueue('user-1');
  expect(listed?.failed).toBe(false);
  expect(listed?.attempts).toBe(0);
  expect(listed?.nextAttemptAt).toBe(0);
});

test('a replacement enqueued mid-run does not interrupt the running upload or lose the new photo', async () => {
  // I1 end-to-end, against the real queueStore (not the simplified FakeStore runQueue.test.ts
  // uses): gate `prepare` for garment g, call enqueueReplacement(g) while that first run is still
  // mid-`prepare`, then release. The old run must still commit (using the data it already read),
  // removing only its own row/files; the replacement row must survive untouched and be picked up
  // by a follow-up pass.
  const queueStore = await loadQueueStore();
  const { runQueue } = await import('../runQueue');
  registerSourceFile('file:///cache/g.jpg');

  const [original] = queueStore.enqueuePhotos('user-1', ['file:///cache/g.jpg']) as [QueueItem];

  let releasePrepare!: () => void;
  const gate = new Promise<void>((resolve) => {
    releasePrepare = resolve;
  });
  const steps = {
    prepare: jest.fn(async (sourceUri: string) => {
      await gate;
      return { fullUri: `${sourceUri}.full.webp`, thumbUri: `${sourceUri}.thumb.webp` };
    }),
    upload: jest.fn(() => Promise.resolve()),
    commit: jest.fn(() => Promise.resolve()),
  };

  const firstRun = runQueue('user-1', steps, queueStore, () => 0);
  await Promise.resolve();
  await Promise.resolve();

  registerSourceFile('file:///cache/g-replacement.jpg');
  const replacement = queueStore.enqueueReplacement('user-1', original.garmentId, 'file:///cache/g-replacement.jpg');

  releasePrepare();
  const firstResult = await firstRun;

  expect(firstResult.committed).toBe(1);
  expect(steps.commit).toHaveBeenCalledTimes(1);

  // The replacement survived the first run's saveItem/removeItem calls untouched.
  const [afterFirstRun] = queueStore.listQueue('user-1');
  expect(afterFirstRun?.garmentId).toBe(replacement.garmentId);
  expect(afterFirstRun?.sourceUri).toBe(replacement.sourceUri);
  expect(afterFirstRun?.stage).toBe('captured');
  expect(mockFiles.has(replacement.sourceUri)).toBe(true);

  // A follow-up pass picks up and commits the replacement normally.
  const secondResult = await runQueue('user-1', steps, queueStore, () => 0);
  expect(secondResult.committed).toBe(1);
  expect(queueStore.listQueue('user-1')).toHaveLength(0);
});
