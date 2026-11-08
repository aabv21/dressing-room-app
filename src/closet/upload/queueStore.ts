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

/** Copies `sourceUri` into `Paths.document/uploads/<garmentId>-source.<ext>` and returns its URI. */
function copyIntoUploads(garmentId: string, sourceUri: string): string {
  const uploadsDir = new Directory(Paths.document, 'uploads');
  uploadsDir.create({ intermediates: true, overwrite: false });
  const ext = Paths.extname(sourceUri).replace(/^\./, '') || 'jpg';
  const destination = new File(uploadsDir, `${garmentId}-source.${ext}`);
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
  return item;
}

export function listQueue(userId: string): QueueItem[] {
  const rows = db.getAllSync<QueueRow>(
    'SELECT * FROM upload_queue WHERE user_id = ? ORDER BY created_at ASC;',
    [userId],
  );
  return rows.map(rowToItem);
}

export function saveItem(item: QueueItem): void {
  upsert(item);
}

export function removeItem(item: QueueItem): void {
  db.runSync('DELETE FROM upload_queue WHERE garment_id = ?;', [item.garmentId]);
  deleteIfExists(item.sourceUri);
  deleteIfExists(item.fullUri);
  deleteIfExists(item.thumbUri);
}

export function resetFailed(userId: string): void {
  db.runSync(
    'UPDATE upload_queue SET failed = 0, attempts = 0, next_attempt_at = 0 WHERE user_id = ?;',
    [userId],
  );
}
