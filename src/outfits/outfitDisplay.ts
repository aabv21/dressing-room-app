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

/** A stable sort into `SLOT_ORDER`, so same-slot pieces keep their input order. */
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

/** For a weekday or month name opening a label. */
export function capitalize(text: string): string {
  const [first, ...rest] = text;
  return first === undefined ? text : first.toLocaleUpperCase() + rest.join('');
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

/** The first stored For you idea for the weakest slot, named after "Missing something?" (no model call). */
export function missingPieceIdea(ideas: readonly ForYouCard[], weakestSlot: Slot | null): ForYouCard | null {
  if (weakestSlot === null) return null;
  return ideas.find((idea) => CATEGORY_SLOT[idea.category] === weakestSlot) ?? null;
}
