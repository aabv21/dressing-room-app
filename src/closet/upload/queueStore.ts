import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { openDatabaseSync } from 'expo-sqlite';

/**
 * Persisted, resumable upload queue storage: one row per garment photo, surviving app restarts
 * and offline launches. `runQueue.ts` drives items through these stages; this module only
 * persists them and manages their on-device copies under `Paths.document/uploads/`.
 */

export type QueueStage = 'captured' | 'prepared' | 'uploaded';

export type QueueItem = {
  garmentId: string;
  userId: string;
  replace: boolean;
  sourceUri: string;
  stage: QueueStage;
  fullUri: string | null;
  thumbUri: string | null;
  attempts: number;
  nextAttemptAt: number;
  failed: boolean;
  createdAt: number;
};

type QueueRow = {
  garment_id: string;
  user_id: string;
  replace: number;
  source_uri: string;
  stage: QueueStage;
  full_uri: string | null;
  thumb_uri: string | null;
  attempts: number;
  next_attempt_at: number;
  failed: number;
  created_at: number;
};

const db = openDatabaseSync('upload-queue.db');

db.execSync(`
  CREATE TABLE IF NOT EXISTS upload_queue (
    garment_id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    "replace" INTEGER NOT NULL,
    source_uri TEXT NOT NULL,
    stage TEXT NOT NULL,
    full_uri TEXT,
    thumb_uri TEXT,
    attempts INTEGER NOT NULL,
    next_attempt_at INTEGER NOT NULL,
    failed INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

function rowToItem(row: QueueRow): QueueItem {
  return {
    garmentId: row.garment_id,
    userId: row.user_id,
    replace: row['replace'] === 1,
    sourceUri: row.source_uri,
    stage: row.stage,
    fullUri: row.full_uri,
    thumbUri: row.thumb_uri,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    failed: row.failed === 1,
    createdAt: row.created_at,
  };
}

function upsert(item: QueueItem): void {
  db.runSync(
    `INSERT INTO upload_queue
       (garment_id, user_id, "replace", source_uri, stage, full_uri, thumb_uri, attempts, next_attempt_at, failed, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(garment_id) DO UPDATE SET
       user_id = excluded.user_id,
       "replace" = excluded."replace",
       source_uri = excluded.source_uri,
       stage = excluded.stage,
       full_uri = excluded.full_uri,
       thumb_uri = excluded.thumb_uri,
       attempts = excluded.attempts,
       next_attempt_at = excluded.next_attempt_at,
       failed = excluded.failed,
       created_at = excluded.created_at;`,
    [
      item.garmentId,
      item.userId,
      item.replace ? 1 : 0,
      item.sourceUri,
      item.stage,
      item.fullUri,
      item.thumbUri,
      item.attempts,
      item.nextAttemptAt,
      item.failed ? 1 : 0,
      item.createdAt,
    ],
  );
}

function getRow(garmentId: string): QueueRow | null {
  return db.getFirstSync<QueueRow>('SELECT * FROM upload_queue WHERE garment_id = ?;', [garmentId]);
}

// NOTE (P3-R8): named `<garmentId>-<uuid>-source.<ext>`, not the brief's `<garmentId>-source.<ext>`.
// A fixed name would let a replacement's copy collide with (and be deleted alongside) the row a
// worker already in flight for the same garment is using — see `saveItem`/`removeItem` below,
// which key on `source_uri` instead of only `garment_id` to survive that race. Ceiling: file names
// are no longer predictable from `garmentId` alone; upgrade path: none needed, callers always get
// the name back from the returned `QueueItem.sourceUri`.
function copyIntoUploads(garmentId: string, sourceUri: string): string {
  const uploadsDir = new Directory(Paths.document, 'uploads');
  // `idempotent: true` (not `overwrite`) is what makes a second `create()` call on an already-
  // existing directory succeed silently instead of throwing — `overwrite` only controls whether an
  // *existing* directory's contents are replaced, not whether "already exists" itself is an error.
  uploadsDir.create({ intermediates: true, idempotent: true });
  const ext = Paths.extname(sourceUri).replace(/^\./, '') || 'jpg';
  const destination = new File(uploadsDir, `${garmentId}-${Crypto.randomUUID()}-source.${ext}`);
  const source = new File(sourceUri);
  source.copySync(destination, { overwrite: true });
  return destination.uri;
}

/** Deletes a file at `uri`, ignoring a file that is already gone. */
function deleteIfExists(uri: string | null): void {
  if (uri === null) return;
  const file = new File(uri);
  if (!file.exists) return;
  try {
    file.delete();
  } catch {
    // Already gone, or unreadable — nothing left to clean up.
  }
}

export function enqueuePhotos(userId: string, sourceUris: readonly string[]): QueueItem[] {
  const now = Date.now();
  return sourceUris.map((sourceUri) => {
    const garmentId = Crypto.randomUUID();
    const copiedUri = copyIntoUploads(garmentId, sourceUri);
    const item: QueueItem = {
      garmentId,
      userId,
      replace: false,
      sourceUri: copiedUri,
      stage: 'captured',
      fullUri: null,
      thumbUri: null,
      attempts: 0,
      nextAttemptAt: 0,
      failed: false,
      createdAt: now,
    };
    upsert(item);
    return item;
  });
}

export function enqueueReplacement(userId: string, garmentId: string, sourceUri: string): QueueItem {
  const previous = getRow(garmentId);
  const copiedUri = copyIntoUploads(garmentId, sourceUri);
  const item: QueueItem = {
    garmentId,
    userId,
    replace: true,
    sourceUri: copiedUri,
    stage: 'captured',
    fullUri: null,
    thumbUri: null,
    attempts: 0,
    nextAttemptAt: 0,
    failed: false,
    createdAt: Date.now(),
  };
  upsert(item);
  // The old row's files are only ours to delete here if no worker is (or will be) mid-run on them:
  // a 'captured' item has nothing running yet, and a failed item's run already gave up. Anything
  // else (prepared/uploaded, not failed) may have a worker about to call `saveItem`/`removeItem`
  // with its own stale snapshot — those calls are keyed on `source_uri`, so once this replacement
  // has overwritten the row, the worker's write will no-op and its `removeItem` will delete only
  // the files named in its own (old) snapshot, cleaning them up safely once it finishes.
  if (previous !== null && (previous.stage === 'captured' || previous.failed === 1)) {
    deleteIfExists(previous.source_uri);
    deleteIfExists(previous.full_uri);
    deleteIfExists(previous.thumb_uri);
  }
  return item;
}

export function listQueue(userId: string): QueueItem[] {
  const rows = db.getAllSync<QueueRow>(
    'SELECT * FROM upload_queue WHERE user_id = ? ORDER BY created_at ASC;',
    [userId],
  );
  return rows.map(rowToItem);
}

// `saveItem`/`removeItem` are called by a running `runQueue` worker holding a `QueueItem` it read
// at the start of its pass. If `enqueueReplacement` swaps that same garment's row for a new one
// (new `source_uri`) while the worker is mid-run, the worker's write must not clobber the
// replacement or delete its files: both statements below are conditioned on `source_uri` still
// matching the snapshot the caller holds, so a stale write affects zero rows instead of the
// replacement's row (Review Focus 1: no photo lost, no garment duplicated).

export function saveItem(item: QueueItem): void {
  db.runSync(
    `UPDATE upload_queue SET
       user_id = ?,
       "replace" = ?,
       stage = ?,
       full_uri = ?,
       thumb_uri = ?,
       attempts = ?,
       next_attempt_at = ?,
       failed = ?,
       created_at = ?
     WHERE garment_id = ? AND source_uri = ?;`,
    [
      item.userId,
      item.replace ? 1 : 0,
      item.stage,
      item.fullUri,
      item.thumbUri,
      item.attempts,
      item.nextAttemptAt,
      item.failed ? 1 : 0,
      item.createdAt,
      item.garmentId,
      item.sourceUri,
    ],
  );
}

export function removeItem(item: QueueItem): void {
  const result = db.runSync('DELETE FROM upload_queue WHERE garment_id = ? AND source_uri = ?;', [
    item.garmentId,
    item.sourceUri,
  ]);
  if (result.changes === 0) return;
  deleteIfExists(item.sourceUri);
  deleteIfExists(item.fullUri);
  deleteIfExists(item.thumbUri);
}

/** Removes every queued photo of `userId`, rows and on-device copies (pause the queue first). */
export function clearQueue(userId: string): void {
  for (const item of listQueue(userId)) {
    removeItem(item);
  }
}

export function resetFailed(userId: string): void {
  db.runSync(
    'UPDATE upload_queue SET failed = 0, attempts = 0, next_attempt_at = 0 WHERE user_id = ?;',
    [userId],
  );
}
