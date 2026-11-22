// This phone's choices for the server's notices, per account in kv `push.<userId>` (the `<name>.<id>`
// shape, so account deletion clears it); the server's push_tokens row is what it sends to.
import { useMemo, useSyncExternalStore } from 'react';

import { kvGet, kvGetJson, kvSet, parseJson } from '../lib/kv';

/** `token` is the Expo push token this phone registered, null when nothing is stored on the server. */
export type PushSettings = { token: string | null; reviewReady: boolean; weekly: boolean };

export const DEFAULT_PUSH: PushSettings = { token: null, reviewReady: false, weekly: false };

export function pushKey(userId: string): string {
  return `push.${userId}`;
}

function isSettings(value: unknown): value is PushSettings {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    (entry.token === null || typeof entry.token === 'string') &&
    typeof entry.reviewReady === 'boolean' &&
    typeof entry.weekly === 'boolean'
  );
}

export function readPush(userId: string): PushSettings {
  return kvGetJson(pushKey(userId), isSettings) ?? DEFAULT_PUSH;
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function writePush(userId: string, settings: PushSettings): void {
  kvSet(pushKey(userId), JSON.stringify(settings));
  for (const listener of listeners) listener();
}

/** The stored settings, re-read whenever any code writes them. */
export function usePushSettings(userId: string): PushSettings {
  const raw = useSyncExternalStore(subscribe, () => kvGet(pushKey(userId)));
  return useMemo(() => parseJson(raw, isSettings) ?? DEFAULT_PUSH, [raw]);
}
