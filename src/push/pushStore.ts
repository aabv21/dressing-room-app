// This phone's choices for the server's notices, per account in kv `push.<userId>` (the `<name>.<id>`
// shape, so account deletion clears it); the server's push_tokens row is what it sends to.
import { getRandomBytes } from 'expo-crypto';
import { useMemo, useSyncExternalStore } from 'react';

import { kvGet, kvGetJson, kvRemove, kvSet, parseJson } from '../lib/kv';

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

/**
 * Tokens a sign-out couldn't delete, kept device-wide (not `<name>.<id>`, so forgetting an account
 * keeps them) until `push-unregister` succeeds.
 */
export const PENDING_UNREGISTER_KEY = 'push.pendingUnregister';

const isTokenList = (value: unknown): value is string[] => Array.isArray(value) && value.every((entry) => typeof entry === 'string');

export function readPendingUnregister(): string[] {
  return kvGetJson(PENDING_UNREGISTER_KEY, isTokenList) ?? [];
}

export function writePendingUnregister(tokens: readonly string[]): void {
  if (tokens.length === 0) kvRemove(PENDING_UNREGISTER_KEY);
  else kvSet(PENDING_UNREGISTER_KEY, JSON.stringify([...new Set(tokens)]));
}

/** This phone's own secret, device-wide like the pending list: it proves the phone to the server. */
export const DEVICE_SECRET_KEY = 'push.deviceSecret';

const DEVICE_SECRET = /^[0-9a-f]{64}$/;

/** 256 random bits as hex, made on first use and kept until the app's data is cleared. */
export function deviceSecret(): string {
  const stored = kvGet(DEVICE_SECRET_KEY);
  if (stored !== null && DEVICE_SECRET.test(stored)) return stored;
  const made = Array.from(getRandomBytes(32), (byte) => byte.toString(16).padStart(2, '0')).join('');
  kvSet(DEVICE_SECRET_KEY, made);
  return made;
}
