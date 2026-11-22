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
  // eslint-disable-next-line security/detect-object-injection -- `locale` and `key` are closed unions the type checker enforces
  const template = catalogs[locale][key];
  if (params === undefined) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    // eslint-disable-next-line security/detect-object-injection -- read-only lookup in the caller's own params; a missing name keeps the placeholder
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
  // NOTE: Hermes lacks `Intl.PluralRules` (throws on-device, not under Jest); en and es agree (singular only at 1).
  // Upgrade: `@formatjs/intl-pluralrules` (Hermes force-polyfill) when a locale with richer plurals is added.
  const key = count === 1 ? 'wear.one' : 'wear.other';
  return translate(locale, key, { count });
}

export type PluralBase =
  | 'closet.processing'
  | 'closet.waiting'
  | 'closet.failed'
  | 'closet.reviewBanner'
  | 'camera.count'
  | 'stats.kpi.outfits'
  | 'stats.kpi.streak'
  | 'diary.outfits'
  | 'saved.count'
  | 'profile.hidden.count'
  | 'profile.hidden.confirmTitle'
  | 'forYou.outfits'
  | 'trip.days'
  | 'trip.item';

/** `{base}.one` for exactly 1, otherwise `{base}.other` — the same en/es rule as `formatWearCount`. */
export function pluralKey(base: PluralBase, count: number): MessageKey {
  return count === 1 ? `${base}.one` : `${base}.other`;
}

export function useI18n(): {
  locale: Locale;
  t: (key: MessageKey, params?: Readonly<Record<string, string | number>>) => string;
} {
  // NOTE: reads device languages once per mount, not on an OS change; upgrade: expo-localization's `useLocales()`.
  const deviceLocale = useMemo(() => resolveLocale(getLocales().map((entry) => entry.languageTag)), []);

  // `'system'` outside an `I18nProvider` (e.g. an isolated component test), so `locale` is `deviceLocale`.
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
