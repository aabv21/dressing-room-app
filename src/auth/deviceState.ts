import { kvGet, kvRemove, kvSet } from '../lib/kv';

/**
 * Small per-account facts kept on the device so an offline launch behaves like the last online
 * one. Each entry records the account it belongs to and is only ever read back for that account.
 */

const ONBOARDING_KEY = 'onboarding-complete';
const LANGUAGE_PENDING_KEY = 'language-save-pending';

type OnboardingEntry = { userId: string; complete: boolean };

function readOnboardingEntry(): OnboardingEntry | null {
  const raw = kvGet(ONBOARDING_KEY);
  if (raw === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'userId' in parsed &&
      typeof parsed.userId === 'string' &&
      'complete' in parsed &&
      typeof parsed.complete === 'boolean'
    ) {
      return { userId: parsed.userId, complete: parsed.complete };
    }
  } catch {
    // An unreadable entry is treated as absent.
  }
  return null;
}

/** The last onboarding status read from the server for `userId`, or null if none is cached. */
export function cachedOnboarding(userId: string): boolean | null {
  const entry = readOnboardingEntry();
  return entry !== null && entry.userId === userId ? entry.complete : null;
}

export function cacheOnboarding(userId: string, complete: boolean): void {
  kvSet(ONBOARDING_KEY, JSON.stringify({ userId, complete } satisfies OnboardingEntry));
}

export function clearCachedOnboarding(): void {
  kvRemove(ONBOARDING_KEY);
}

/** Records that `userId`'s language choice is newer on this device than on the server. */
export function markLanguageSavePending(userId: string): void {
  kvSet(LANGUAGE_PENDING_KEY, userId);
}

export function isLanguageSavePending(userId: string): boolean {
  return kvGet(LANGUAGE_PENDING_KEY) === userId;
}

export function clearLanguageSavePending(userId: string): void {
  if (isLanguageSavePending(userId)) {
    kvRemove(LANGUAGE_PENDING_KEY);
  }
}

/** Drops whatever another account left on this device, once `userId` signs in here. */
export function forgetOtherAccounts(userId: string): void {
  const onboarding = readOnboardingEntry();
  if (onboarding !== null && onboarding.userId !== userId) {
    kvRemove(ONBOARDING_KEY);
  }
  const pendingFor = kvGet(LANGUAGE_PENDING_KEY);
  if (pendingFor !== null && pendingFor !== userId) {
    kvRemove(LANGUAGE_PENDING_KEY);
  }
}
