// The combinations dismissed on this device ("Not for me"), so Today hides them from a stored or older
// list, also after a restart. The server's `dismissed_outfits` is the source of truth for new lists.
import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { kvGet, kvGetJson, kvSet, parseJson } from '../lib/kv';

/** The record's kv key; its `<name>.<id>` shape lets the account cleanup clear it. */
export function storedDismissedKey(userId: string): string {
  return `outfits.dismissed.${userId}`;
}

// NOTE: the device keeps the latest 500; upgrade path: page `dismissed_outfits` from the server if someone dismisses more.
const MAX_STORED = 500;

const isKeys = (value: unknown): value is string[] => Array.isArray(value) && value.every((key) => typeof key === 'string');

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function write(userId: string, keys: readonly string[]): void {
  kvSet(storedDismissedKey(userId), JSON.stringify(keys.slice(-MAX_STORED)));
  for (const listener of listeners) listener();
}

export function readDismissed(userId: string): string[] {
  return kvGetJson(storedDismissedKey(userId), isKeys) ?? [];
}

export function addDismissed(userId: string, outfitKey: string): void {
  const keys = readDismissed(userId);
  if (!keys.includes(outfitKey)) write(userId, [...keys, outfitKey]);
}

export function removeDismissed(userId: string, outfitKey: string): void {
  write(
    userId,
    readDismissed(userId).filter((key) => key !== outfitKey),
  );
}

export function clearDismissed(userId: string): void {
  write(userId, []);
}

/** The dismissed keys for `userId`, re-read whenever they change (Profile's restore included). */
export function useDismissed(userId: string | null): ReadonlySet<string> {
  const getSnapshot = useCallback(() => (userId === null ? null : kvGet(storedDismissedKey(userId))), [userId]);
  const raw = useSyncExternalStore(subscribe, getSnapshot);
  return useMemo(() => new Set(parseJson(raw, isKeys) ?? []), [raw]);
}
