// A garment's optional price and its cost per wear (docs/app.md#the-closet-srccloset). Amounts in
// different currencies are never summed or compared.
import { getLocales } from 'expo-localization';

import type { Locale } from '../i18n';

/** The picker's short list: the main Latin American currencies, the dollar and the euro. */
export const COMMON_CURRENCIES = ['USD', 'COP', 'MXN', 'EUR', 'VES', 'ARS', 'CLP', 'PEN', 'BRL'] as const;

/** `numeric(10,2)`'s ceiling. */
export const MAX_PRICE = 99_999_999.99;

const CURRENCY_CODE = /^[A-Z]{3}$/;
const DIGITS = /^\d+$/;
const FALLBACK_CURRENCY = 'USD';

function isCurrencyCode(value: string): boolean {
  return CURRENCY_CODE.test(value);
}

/** A garment's price with its currency, or null; a row cached by an older build lacks both columns. */
export function priceOf(garment: {
  price?: number | null | undefined;
  currency?: string | null | undefined;
}): { price: number; currency: string } | null {
  const { price, currency } = garment;
  return price === null || price === undefined || currency === null || currency === undefined ? null : { price, currency };
}

/** The device's currency, for a garment priced for the first time. */
export function deviceCurrency(): string {
  const code = getLocales()[0].currencyCode;
  return code !== null && isCurrencyCode(code) ? code : FALLBACK_CURRENCY;
}

/** The common codes, with any code outside them (the device's, or a stored one) first. */
export function currencyChoices(...extra: readonly (string | null)[]): string[] {
  const common: readonly string[] = COMMON_CURRENCIES;
  const outside = [...new Set(extra.filter((code): code is string => code !== null && !common.includes(code)))];
  return [...outside, ...common];
}

/**
 * "1.200.000" or "1,200": a first group of 1–3 digits, then groups of exactly 3. The first group
 * never starts with 0, so "0.500" and "00,500" are refused rather than read as 500.
 */
function isGrouped(groups: readonly string[]): boolean {
  const [head, ...rest] = groups;
  return (
    head !== undefined &&
    DIGITS.test(head) &&
    head.length <= 3 &&
    !head.startsWith('0') &&
    rest.length > 0 &&
    rest.every((group) => DIGITS.test(group) && group.length === 3)
  );
}

/**
 * Reads what the user typed, in either decimal style: "12,50" and "12.50" are 12.5, and one
 * separator followed by exactly three digits groups thousands ("250.000"). Null for an empty
 * field, 'invalid' for anything else that isn't a price `numeric(10,2)` holds.
 */
export function parsePrice(text: string): number | null | 'invalid' {
  const compact = text.replace(/\s/g, '');
  if (compact === '') return null;
  if (!/^[\d.,]+$/.test(compact)) return 'invalid';
  const lastDot = compact.lastIndexOf('.');
  const lastComma = compact.lastIndexOf(',');
  let whole = compact;
  let cents = '';
  if (lastDot >= 0 && lastComma >= 0) {
    // Both styles: the later separator is the decimal one.
    const decimalAt = Math.max(lastDot, lastComma);
    whole = compact.slice(0, decimalAt);
    cents = compact.slice(decimalAt + 1);
    const grouping = lastDot > lastComma ? ',' : '.';
    if (!isGrouped(whole.split(grouping))) return 'invalid';
    whole = whole.split(grouping).join('');
  } else if (lastDot >= 0 || lastComma >= 0) {
    const separator = lastDot >= 0 ? '.' : ',';
    const parts = compact.split(separator);
    const [head, tail] = parts;
    if (parts.length === 2 && tail !== undefined && head !== undefined && tail.length !== 3) {
      whole = head;
      cents = tail;
      if (cents === '') return 'invalid';
    } else if (isGrouped(parts)) {
      whole = parts.join('');
    } else {
      return 'invalid';
    }
  }
  if (!DIGITS.test(whole) || (cents !== '' && (!DIGITS.test(cents) || cents.length > 2))) return 'invalid';
  const value = Number(cents === '' ? whole : `${whole}.${cents}`);
  return value > MAX_PRICE ? 'invalid' : value;
}

/** A stored price as the field shows it: cents only when there are any, in the locale's decimal style. */
export function priceText(price: number | null, locale: Locale): string {
  if (price === null) return '';
  const text = Number.isInteger(price) ? String(price) : price.toFixed(2);
  return locale === 'es' ? text.replace('.', ',') : text;
}

/** A never-worn piece counts as one wear, so its cost per wear is its price. */
export function costPerWear(price: number, wearCount: number): number {
  return price / Math.max(wearCount, 1);
}

/**
 * The common currencies' fraction digits, set here because devices' ICU data disagree (COP and CLP
 * come out with or without cents). COP, CLP and VES prices are whole amounts in practice; VES
 * keeps céntimos on paper, but no price is quoted in them. Other codes keep their own standard.
 */
const FRACTION_DIGITS: ReadonlyMap<string, number> = new Map([
  ['COP', 0],
  ['CLP', 0],
  ['VES', 0],
  ['USD', 2],
  ['MXN', 2],
  ['EUR', 2],
  ['ARS', 2],
  ['PEN', 2],
  ['BRL', 2],
]);

export function moneyFormatOptions(currency: string): Intl.NumberFormatOptions {
  const digits = FRACTION_DIGITS.get(currency);
  return digits === undefined
    ? { style: 'currency', currency }
    : { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits };
}

const moneyFormats = new Map<string, Intl.NumberFormat>();

export function formatMoney(amount: number, currency: string, locale: Locale): string {
  const key = `${locale}|${currency}`;
  let format = moneyFormats.get(key);
  if (format === undefined) {
    format = new Intl.NumberFormat(locale, moneyFormatOptions(currency));
    moneyFormats.set(key, format);
  }
  return format.format(amount);
}
