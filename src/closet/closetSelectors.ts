import type { MessageKey } from '../i18n';
import { GARMENT_FIELDS, slotOf, type GarmentColor, type GarmentField, type Slot } from './catalog';
import type { GridItem } from './ClosetGrid';
import type { Garment } from './garmentRepository';

/** Pure derivations of the closet's garment list for the Closet and Review screens. */

/** A donated garment has left the active closet: no grid, counts, goal or review (its wears stay in the history). */
export function isActive(g: Garment): boolean {
  return g.status !== 'donated';
}

/** How many colors of a garment count (Stats' color shares and the Items color filter agree). */
export const COUNTED_COLORS = 3;

/** Stats' "Your colors" tap: the color (or "Other") the Items grid is filtered to, and the colors it stands for. */
export type ColorFilter = { id: GarmentColor | 'other'; colors: readonly GarmentColor[] };

/** Whether one of the garment's first `COUNTED_COLORS` colors is in `colors`. */
export function hasAnyColor(g: Garment, colors: ReadonlySet<GarmentColor>): boolean {
  return g.colors.slice(0, COUNTED_COLORS).some((color) => colors.has(color));
}

const STALE_PENDING_MS = 10 * 60 * 1000;

type Translate = (key: MessageKey, params?: Readonly<Record<string, string | number>>) => string;

/** Still `pending` more than 10 minutes after upload: the extraction is treated as failed. */
export function isStalePending(g: Garment, now: number): boolean {
  return g.extraction_status === 'pending' && now - Date.parse(g.created_at) > STALE_PENDING_MS;
}

/**
 * Whether polling should keep waiting on this garment's extraction. A reviewed garment never is:
 * the server skips the write-back once the user has saved a review.
 */
export function isLivePending(g: Garment, now: number): boolean {
  return g.extraction_status === 'pending' && g.reviewed_at === null && !isStalePending(g, now);
}

/** Unreviewed garments whose extraction has finished (or given up), oldest first. */
export function reviewQueue(garments: readonly Garment[], now: number): Garment[] {
  return garments
    .filter((g) => isActive(g) && g.reviewed_at === null && !isLivePending(g, now))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

/** The fields review always needs a value for; category is also required to confirm. */
const BASIC_FIELDS: ReadonlySet<GarmentField> = new Set(['category', 'colors', 'formality', 'seasons']);

function isEmptyBasic(g: Garment, field: GarmentField): boolean {
  switch (field) {
    case 'category':
      return g.category === null;
    case 'colors':
      return g.colors.length === 0;
    case 'formality':
      return g.formality === null;
    case 'seasons':
      return g.seasons.length === 0;
    default:
      return false;
  }
}

/**
 * The fields review asks about, in field order: the ones the AI was unsure of plus any empty basic
 * (category, colors, formality, seasons). When the AI never read the photo (failed, over quota or
 * stale pending), the basics are always asked.
 */
export function fieldsToAsk(g: Garment, now: number): GarmentField[] {
  const unread = g.extraction_status === 'failed' || g.extraction_status === 'over_quota' || isStalePending(g, now);
  return GARMENT_FIELDS.filter(
    (field) => g.uncertain_fields.includes(field) || (BASIC_FIELDS.has(field) && (unread || isEmptyBasic(g, field))),
  );
}

/** Active garments per slot; slots with none are absent, and uncategorized garments aren't counted. */
export function slotCounts(garments: readonly Garment[]): Partial<Record<Slot, number>> {
  const counts = new Map<Slot, number>();
  for (const g of garments) {
    if (g.category !== null && isActive(g)) {
      const slot = slotOf(g.category);
      counts.set(slot, (counts.get(slot) ?? 0) + 1);
    }
  }
  return Object.fromEntries(counts);
}

/**
 * Grid cells for the active garments in `filter` (`'all'` keeps uncategorized ones too) and, when
 * `colors` is given, with one of those colors (Stats' "Your colors" tap). `thumbUrls` is
 * keyed by garment id. The cache key changes only with `photo_version`, so a re-signed URL for the
 * same photo still hits expo-image's disk cache, and a replaced photo never shows the old one.
 */
export function toGridItems(
  garments: readonly Garment[],
  thumbUrls: ReadonlyMap<string, string>,
  filter: Slot | 'all',
  t: Translate,
  colors?: ReadonlySet<GarmentColor>,
): GridItem[] {
  const items: GridItem[] = [];
  for (const g of garments) {
    if (!isActive(g)) {
      continue;
    }
    if (filter !== 'all' && (g.category === null || slotOf(g.category) !== filter)) {
      continue;
    }
    if (colors !== undefined && !hasAnyColor(g, colors)) {
      continue;
    }
    const item: GridItem = {
      id: g.id,
      thumbUri: thumbUrls.get(g.id) ?? '',
      cacheKey: `${g.id}:thumb:${String(g.photo_version)}`,
      wearCount: g.wear_count,
      label: g.category === null ? t('garment.unnamed') : t(`garment.category.${g.category}`),
    };
    if (g.status !== 'available') {
      item.badge = t(`garment.status.${g.status}`);
    }
    items.push(item);
  }
  return items;
}
