import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { kvGet, kvSet } from '../lib/kv';
import type { Locale } from './index';

export type LocalePreference = 'system' | 'en' | 'es';

const LOCALE_PREFERENCE_KEY = 'locale-preference';

function isLocalePreference(value: string): value is LocalePreference {
  return value === 'system' || value === 'en' || value === 'es';
}

function readStoredPreference(): LocalePreference {
  const stored = kvGet(LOCALE_PREFERENCE_KEY);
  if (stored !== null && isLocalePreference(stored)) {
    return stored;
  }
  return 'system';
}

interface LocalePreferenceContextValue {
  preference: LocalePreference;
  setPreference: (preference: LocalePreference) => void;
}

const LocalePreferenceContext = createContext<LocalePreferenceContextValue | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [preference, setPreferenceState] = useState<LocalePreference>(readStoredPreference);

  const setPreference = useCallback((next: LocalePreference) => {
    kvSet(LOCALE_PREFERENCE_KEY, next);
    setPreferenceState(next);
  }, []);

  const value = useMemo(() => ({ preference, setPreference }), [preference, setPreference]);

  return <LocalePreferenceContext.Provider value={value}>{children}</LocalePreferenceContext.Provider>;
}

/**
 * Reads the persisted locale preference. Outside an `I18nProvider` (e.g. a test rendering a
 * component in isolation) this defaults to `'system'`, matching `useI18n`'s own no-provider
 * fallback to the device locale.
 */
export function useLocalePreference(): LocalePreferenceContextValue {
  const context = useContext(LocalePreferenceContext);
  if (context !== undefined) {
    return context;
  }
  return { preference: 'system', setPreference: () => {} };
}

export function preferenceToLocale(preference: LocalePreference, deviceLocale: Locale): Locale {
  return preference === 'system' ? deviceLocale : preference;
}
