import { getLocales } from 'expo-localization';
import { useMemo } from 'react';

import { en } from './en';
import { es } from './es';

export type Locale = 'en' | 'es';
export type MessageKey = keyof typeof en;

const catalogs: Record<Locale, Record<MessageKey, string>> = { en, es };

const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'es'];

function isSupportedLocale(tag: string): tag is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(tag);
}

export function resolveLocale(languageTags: readonly string[]): Locale {
  for (const tag of languageTags) {
    const primarySubtag = tag.split('-')[0]?.toLowerCase();
    if (primarySubtag !== undefined && isSupportedLocale(primarySubtag)) {
      return primarySubtag;
    }
  }
  return 'en';
}

export function translate(
  locale: Locale,
  key: MessageKey,
  params?: Readonly<Record<string, string | number>>,
): string {
  const template = catalogs[locale][key];
  if (params === undefined) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined) {
      return match;
    }
    return typeof value === 'number' ? new Intl.NumberFormat(locale).format(value) : value;
  });
}

export function formatWearCount(count: number, locale: Locale): string {
  if (count === 0) {
    return translate(locale, 'wear.never');
  }
  const key = new Intl.PluralRules(locale).select(count) === 'one' ? 'wear.one' : 'wear.other';
  return translate(locale, key, { count });
}

export function useI18n(): {
  locale: Locale;
  t: (key: MessageKey, params?: Readonly<Record<string, string | number>>) => string;
} {
  // NOTE: reads device languages once per mount; it does not react to an OS language
  // change while the app is running. Upgrade path: swap to expo-localization's
  // `useLocales()` if live-updating locale is ever needed.
  const locale = useMemo(() => resolveLocale(getLocales().map((entry) => entry.languageTag)), []);

  const t = useMemo(
    () =>
      (key: MessageKey, params?: Readonly<Record<string, string | number>>): string =>
        translate(locale, key, params),
    [locale],
  );

  return { locale, t };
}
