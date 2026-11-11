// Pure display helpers for a built or rated outfit: the slot order pieces render in, a garment's
// short label, and the Today screen's weather line.

import { CATEGORY_SLOT, type GarmentCategory, type GarmentColor, type Slot } from '../closet/catalog';
import { translate, type Locale, type MessageKey } from '../i18n';
import type { ForYouCard, WeatherSummary } from './types';

/** Display order for an outfit's pieces: outerwear on top, shoes at the bottom. */
export const SLOT_ORDER: readonly Slot[] = [
  'outerwear',
  'top',
  'one_piece',
  'bottom',
  'shoes',
  'bag',
  'headwear',
  'accessory',
];

const SLOT_RANK = new Map<Slot, number>(SLOT_ORDER.map((slot, index) => [slot, index]));

/** `SLOT_ORDER`'s rank, or after every known slot for a piece with no category. */
function rankOf(category: GarmentCategory | null): number {
  if (category === null) return SLOT_ORDER.length;
  // eslint-disable-next-line security/detect-object-injection -- `category` is the closed GarmentCategory union
  return SLOT_RANK.get(CATEGORY_SLOT[category]) ?? SLOT_ORDER.length;
}

/** Sorts pieces into display order (`SLOT_ORDER`); a stable sort, so same-slot pieces keep their input order. */
export function orderPieces<T extends { category: GarmentCategory | null }>(pieces: readonly T[]): T[] {
  return pieces
    .map((piece, index) => ({ piece, index }))
    .sort((a, b) => rankOf(a.piece.category) - rankOf(b.piece.category) || a.index - b.index)
    .map(({ piece }) => piece);
}

type Translator = (key: MessageKey) => string;

/** "{category label} · {first color label}", e.g. "Blusa · Blanco". */
export function pieceLabel(
  garment: { category: GarmentCategory | null; colors: readonly GarmentColor[] },
  t: Translator,
): string {
  const categoryLabel = garment.category === null ? t('garment.unnamed') : t(`garment.category.${garment.category}`);
  const firstColor = garment.colors[0];
  return firstColor === undefined ? categoryLabel : `${categoryLabel} · ${t(`garment.color.${firstColor}`)}`;
}

function capitalize(word: string): string {
  const [first, ...rest] = word;
  return first === undefined ? word : first.toLocaleUpperCase() + rest.join('');
}

/** The capitalized weekday, e.g. "Martes": Today's header always names the day. */
export function formatWeekday(locale: Locale, now: Date = new Date()): string {
  return capitalize(new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(now));
}

/** "{Weekday} · {temp} °C, {condition}", e.g. "Martes · 24 °C, soleado"; null when there's no weather. */
export function formatWeather(weather: WeatherSummary | null, locale: Locale, now: Date = new Date()): string | null {
  if (weather === null) return null;
  const weekday = formatWeekday(locale, now);
  const key: MessageKey = `weather.condition.${weather.condition}`;
  const condition = translate(locale, key);
  return `${weekday} · ${String(Math.round(weather.tempC))} °C, ${condition}`;
}

/**
 * The first For you idea for the outfit's weakest slot (mockup 01 screen 3's "Un cinturón camel lo
 * mejoraría"): the rating screen names it after "Missing something?". Taken from the stored For you
 * answer, so it costs no model call; null when there's none for that slot.
 */
export function missingPieceIdea(ideas: readonly ForYouCard[], weakestSlot: Slot | null): ForYouCard | null {
  if (weakestSlot === null) return null;
  return ideas.find((idea) => CATEGORY_SLOT[idea.category] === weakestSlot) ?? null;
}
