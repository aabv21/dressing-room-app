import { signOutLocally, storedSessionUserId } from '../auth/authService';
import type { MessageKey } from '../i18n';
import { deleteAccount, verifyAccount } from './accountClient';
import type { AccountError } from './accountClient';
import { clearDeletionMarker, DELETION_SETTLE_MS, deletionState, markDeletion, readDeletionMarker } from './deletionMarker';
import { forgetDeviceFiles } from './deviceFiles';
import { forgetAccountOnDevice } from './forgetAccount';

/** The upload queue controls the deletion needs (`useUploadQueue`'s). */
export type QueueControl = {
  pause: () => Promise<void>;
  clear: () => void;
  resume: (options?: { run?: boolean }) => void;
};

/** `busy`: a deletion or launch check for this user is already running (e.g. a double tap). */
export type DeletionResult = 'deleted' | 'reauth' | AccountError | 'busy';

const running = new Set<string>();

/** Session still `userId`'s, or none: a late answer must never sign out or speak to a newer account. */
export function sessionStillFor(userId: string): boolean {
  try {
    const current = storedSessionUserId();
    return current === null || current === userId;
  } catch {
    // Unreadable storage: assume another account, so nobody is signed out by mistake.
    return false;
  }
}

async function signOutIfStill(userId: string): Promise<void> {
  if (sessionStillFor(userId)) await signOutLocally();
}

/** The device side of a confirmed deletion; each step runs on its own, so a failing one never skips the rest. */
async function finishLocally(userId: string, queue: QueueControl): Promise<void> {
  try {
    queue.clear();
  } catch {
    // The rows stay but never run: the marker blocks the queue until the cleanup below.
  }
  await signOutIfStill(userId);
  try {
    forgetAccountOnDevice(userId);
  } catch {
    // AuthProvider's sign-out handling drops the data of a still-marked account as well.
  }
  await forgetDeviceFiles();
  queue.resume({ run: false });
}

/**
 * Only ever started by the user's tap; each outcome: docs/app.md#account-deletion-on-the-device.
 * The queue is unpaused in every case, never with a run.
 */
export async function runDeletion(userId: string, queue: QueueControl): Promise<DeletionResult> {
  if (running.has(userId)) return 'busy';
  running.add(userId);
  try {
    try {
      markDeletion(userId, 'deleting');
    } catch {
      return 'unknown';
    }
    let outcome: Awaited<ReturnType<typeof deleteAccount>>;
    try {
      await queue.pause();
      outcome = await deleteAccount();
    } catch {
      outcome = { ok: false, error: 'unknown' };
    }
    if (outcome.ok) {
      await finishLocally(userId, queue);
      return 'deleted';
    }
    if (outcome.error === 'reauth') {
      try {
        // Unless supabase-js's own sign-out (a refused refresh) already dropped the data, marker included.
        if (deletionState(userId) !== null) markDeletion(userId, 'reauth');
      } catch {
        // Left as `deleting`: the sign-out below then drops the device data instead.
      }
      await signOutIfStill(userId);
      queue.resume({ run: false });
      return 'reauth';
    }
    queue.resume({ run: false });
    return outcome.error;
  } finally {
    running.delete(userId);
  }
}

export { DELETION_SETTLE_MS };

/**
 * The verify-only check while a deletion is marked: docs/app.md#account-deletion-on-the-device. A marker
 * time that can't be trusted is stamped now, so the settle window starts over instead of being skipped.
 */
export async function confirmPendingDeletion(
  userId: string,
  queue: QueueControl,
  now: () => number = Date.now,
): Promise<'deleted' | 'kept' | 'pending' | 'busy'> {
  if (running.has(userId)) return 'busy';
  running.add(userId);
  try {
    const status = await verifyAccount(userId);
    if (status === 'gone') {
      await finishLocally(userId, queue);
      return 'deleted';
    }
    const marker = readDeletionMarker(userId, now());
    if (status === 'exists' && marker !== null && marker.markedAt === null) {
      try {
        markDeletion(userId, marker.state, now());
      } catch {
        // NOTE: the marker stays as it was; the next check tries to stamp it again.
      }
      return 'pending';
    }
    if (status === 'exists' && marker !== null && marker.markedAt !== null && now() - marker.markedAt >= DELETION_SETTLE_MS) {
      try {
        clearDeletionMarker(userId);
      } catch {
        return 'pending';
      }
      queue.resume();
      return 'kept';
    }
    return 'pending';
  } finally {
    running.delete(userId);
  }
}

/** The message for a deletion that didn't end in Welcome, if any. */
export function deletionMessage(result: DeletionResult): MessageKey | undefined {
  switch (result) {
    case 'reauth':
      return 'profile.privacy.deleteError.reauth';
    case 'network':
      return 'profile.privacy.deleteError.network';
    case 'unknown':
      return 'profile.privacy.deleteError.unknown';
    case 'deleted':
    case 'busy':
      return undefined;
  }
}
