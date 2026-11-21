// For you's ideas in the app's language, with the last good answer kept on the device (`storedForYou.ts`).
import { useIsFocused } from 'expo-router';
import { useCallback } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { useI18n } from '../i18n';
import { localDate } from '../lib/localDate';
import { fetchForYou, type AiError } from './aiClient';
import { readStoredForYou, storeForYou } from './storedForYou';
import type { ForYouCard, ForYouResponse } from './types';
import { useStoredQuery } from './useStoredQuery';

export type ForYouState = 'loading' | 'ready' | 'too_small' | 'error';

export type ForYouIdeas = {
  state: ForYouState;
  /** The ideas shown; empty unless `state` is `ready` (and possibly then, when none came up). */
  ideas: ForYouCard[];
  /** Why there's nothing to show (`state` is `error`). */
  error: AiError | null;
  /** The latest fetch failed with this, and the ideas shown are the last good ones. */
  failed: AiError | null;
  reload: () => void;
};

/**
 * Fetches on focus (picking up closet changes), on a language change and on `reload`, one request at a
 * time: a concurrent call would spend the day's single quota twice and get a 429. The cache makes
 * refetches cheap.
 */
export function useForYou(): ForYouIdeas {
  const { userId } = useAuth();
  const { locale } = useI18n();
  const focused = useIsFocused();

  const readStored = useCallback(() => (userId === null ? null : readStoredForYou(userId, locale)), [userId, locale]);
  const { data, status, error, reload } = useStoredQuery<ForYouResponse>({
    key: `${userId ?? ''}|${locale}`,
    enabled: focused && userId !== null,
    fetch: () => fetchForYou({ language: locale, date: localDate() }),
    readStored,
    store: (result) => {
      if (userId !== null) storeForYou(userId, locale, result);
    },
  });

  let state: ForYouState;
  if (data !== null) state = data.kind === 'too_small' ? 'too_small' : 'ready';
  else state = status === 'loading' ? 'loading' : 'error';

  return {
    state,
    ideas: data?.kind === 'ok' ? data.ideas : [],
    error: data === null ? error : null,
    failed: data === null ? null : error,
    reload,
  };
}
