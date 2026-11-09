import { getLocales } from 'expo-localization';
import { useMemo } from 'react';

import { en } from './en';
import { es } from './es';
import { preferenceToLocale, useLocalePreference } from './I18nProvider';

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

const numberFormats = new Map<Locale, Intl.NumberFormat>();

function numberFormat(locale: Locale): Intl.NumberFormat {
  let format = numberFormats.get(locale);
  if (format === undefined) {
    format = new Intl.NumberFormat(locale);
    numberFormats.set(locale, format);
  }
  return format;
}

/** Whether `key` is a catalog key, e.g. a message key sent by a function (`rating.reason.*`). */
export function isMessageKey(key: string): key is MessageKey {
  return Object.hasOwn(en, key);
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
    return typeof value === 'number' ? numberFormat(locale).format(value) : value;
  });
}

export function formatWearCount(count: number, locale: Locale): string {
  if (count === 0) {
    return translate(locale, 'wear.never');
  }
  // NOTE: not `Intl.PluralRules` — Hermes (React Native's JS engine) ships `Intl.Collator`,
  // `Intl.DateTimeFormat` and `Intl.NumberFormat` but not `Intl.PluralRules`, so
  // `new Intl.PluralRules(locale)` throws "undefined is not a constructor" on-device even though
  // it works under Jest's Node environment. English and Spanish cardinal plural rules agree for
  // all non-negative integers (singular only at exactly 1), so a direct comparison covers both
  // supported locales without a polyfill. Upgrade path: pull in `@formatjs/intl-pluralrules`
  // (force-polyfill variant for Hermes) if a locale with a richer plural system is ever added.
  const key = count === 1 ? 'wear.one' : 'wear.other';
  return translate(locale, key, { count });
}

export type PluralBase =
  | 'closet.processing'
  | 'closet.failed'
  | 'closet.reviewBanner'
  | 'camera.count'
  | 'stats.kpi.streak'
  | 'diary.outfits';

/** `{base}.one` for exactly 1, otherwise `{base}.other` — the same en/es rule as `formatWearCount`. */
export function pluralKey(base: PluralBase, count: number): MessageKey {
  return count === 1 ? `${base}.one` : `${base}.other`;
}

export function useI18n(): {
  locale: Locale;
  t: (key: MessageKey, params?: Readonly<Record<string, string | number>>) => string;
} {
  // NOTE: reads device languages once per mount; it does not react to an OS language
  // change while the app is running. Upgrade path: swap to expo-localization's
  // `useLocales()` if live-updating locale is ever needed.
  const deviceLocale = useMemo(() => resolveLocale(getLocales().map((entry) => entry.languageTag)), []);

  // Outside an `I18nProvider` (e.g. a component test rendered in isolation) this defaults to
  // `'system'`, so `locale` falls back to `deviceLocale` and existing callers see no change.
  const { preference } = useLocalePreference();
  const locale = useMemo(() => preferenceToLocale(preference, deviceLocale), [preference, deviceLocale]);

  const t = useMemo(
    () =>
      (key: MessageKey, params?: Readonly<Record<string, string | number>>): string =>
        translate(locale, key, params),
    [locale],
  );

  return { locale, t };
}
