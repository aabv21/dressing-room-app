// The daily reminder's settings on this device, per account in kv `reminder.<userId>` (the
// `<name>.<id>` shape, so account deletion clears it).
import { useMemo, useSyncExternalStore } from 'react';

import type { Locale } from '../i18n';
import { kvGet, kvGetJson, kvSet, parseJson } from '../lib/kv';

export type ReminderTime = { hour: number; minute: number };

/** `notificationId` is the scheduled notification to cancel; `language` the copy it was scheduled in. */
export type ReminderSettings = ReminderTime & {
  enabled: boolean;
  notificationId: string | null;
  language: Locale | null;
};

export const DEFAULT_REMINDER: ReminderSettings = { enabled: false, hour: 7, minute: 30, notificationId: null, language: null };

export function reminderKey(userId: string): string {
  return `reminder.${userId}`;
}

function isClock(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
}

function isSettings(value: unknown): value is ReminderSettings {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.enabled === 'boolean' &&
    isClock(entry.hour, 23) &&
    isClock(entry.minute, 59) &&
    (entry.notificationId === null || typeof entry.notificationId === 'string') &&
    (entry.language === null || entry.language === 'en' || entry.language === 'es')
  );
}

export function readReminder(userId: string): ReminderSettings {
  return kvGetJson(reminderKey(userId), isSettings) ?? DEFAULT_REMINDER;
}

// Profile's section and the background re-schedules write the same key; listeners keep every reader
// on the stored value.
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function writeReminder(userId: string, settings: ReminderSettings): void {
  kvSet(reminderKey(userId), JSON.stringify(settings));
  for (const listener of listeners) listener();
}

/** The stored settings, re-read whenever any code writes them. */
export function useReminderSettings(userId: string): ReminderSettings {
  // The raw string is the snapshot: equal text means an unchanged value, so renders stay stable.
  const raw = useSyncExternalStore(subscribe, () => kvGet(reminderKey(userId)));
  return useMemo(() => parseJson(raw, isSettings) ?? DEFAULT_REMINDER, [raw]);
}
