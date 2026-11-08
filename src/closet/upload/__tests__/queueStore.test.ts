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
    if (source.startsWith('DELETE FROM upload_queue')) {
      const [garmentId] = params;
      const existed = rows.delete(garmentId as string);
      return { changes: existed ? 1 : 0, lastInsertRowId: 0 };
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

  return { execSync, runSync, getAllSync, rows };
}

type FakeFile = {
  uri: string;
  exists: boolean;
};

// Named with a `mock` prefix so jest.mock()'s module factory (below) is allowed to close over it.
/** Tracks every file the fake filesystem knows about, keyed by `file://` URI. */
const mockFiles = new Map<string, FakeFile>();

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
    create(): void {
      // No-op: the fake filesystem has no real directories to create.
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

test('enqueueReplacement sets replace to true', async () => {
  const { enqueueReplacement, listQueue } = await loadQueueStore();
  registerSourceFile('file:///cache/replace.jpg');

  const item = enqueueReplacement('user-1', 'garment-42', 'file:///cache/replace.jpg');

  expect(item.replace).toBe(true);
  expect(item.garmentId).toBe('garment-42');
  const [listed] = listQueue('user-1');
  expect(listed?.replace).toBe(true);
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
