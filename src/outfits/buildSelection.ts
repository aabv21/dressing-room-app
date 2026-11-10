// The Build tab's outfit, picked piece by piece: one garment per slot, with the one-piece and
// top/bottom excluding each other and a single accessory (a bag, a hat or an accessory), so an
// outfit never holds more than five pieces (rate-outfit takes at most six).

import { slotOf, SLOTS, type GarmentCategory, type Slot } from '../closet/catalog';
import { isCompleteOutfit } from '../../supabase/functions/_shared/outfitRules.ts';

export type BuildSelection = Partial<Record<Slot, string>>;

/** The slots that hold "the" accessory: v1 allows one of them. */
const ACCESSORY_SLOTS: readonly Slot[] = ['bag', 'headwear', 'accessory'];

/** Slots a garment in `slot` clears when it's chosen. */
function excludedBy(slot: Slot): readonly Slot[] {
  if (slot === 'one_piece') return ['top', 'bottom'];
  if (slot === 'top' || slot === 'bottom') return ['one_piece'];
  if (ACCESSORY_SLOTS.includes(slot)) return ACCESSORY_SLOTS.filter((other) => other !== slot);
  return [];
}

// The selection as a Map while it's edited: no computed keys on a plain object.
function toMap(sel: BuildSelection): Map<Slot, string> {
  return new Map(Object.entries(sel) as [Slot, string][]);
}

function fromMap(map: ReadonlyMap<Slot, string>): BuildSelection {
  return Object.fromEntries(
    SLOTS.flatMap((slot) => {
      const id = map.get(slot);
      return id === undefined ? [] : [[slot, id]];
    }),
  );
}

/**
 * The selection after tapping `garment`: it takes its slot (clearing what it excludes), or clears
 * its slot when it was already the chosen one. A garment with no category can't be placed.
 */
export function selectGarment(
  sel: BuildSelection,
  garment: { id: string; category: GarmentCategory | null },
): BuildSelection {
  if (garment.category === null) return sel;
  const slot = slotOf(garment.category);
  const next = toMap(sel);
  if (next.get(slot) === garment.id) {
    next.delete(slot);
    return fromMap(next);
  }
  for (const other of excludedBy(slot)) next.delete(other);
  next.set(slot, garment.id);
  return fromMap(next);
}

/** The chosen slots make an outfit the rating accepts: (top + bottom) or a one-piece, plus shoes. */
export function canRate(sel: BuildSelection): boolean {
  return isCompleteOutfit([...toMap(sel).keys()]);
}

/** The chosen garment ids, in `SLOTS` order. */
export function selectionIds(sel: BuildSelection): string[] {
  const map = toMap(sel);
  return SLOTS.flatMap((slot) => map.get(slot) ?? []);
}

/**
 * The selection without the pieces that left `usable` (deleted, or sent to the laundry while the
 * tab stayed mounted); the same object when nothing changed.
 */
export function retainSelection(sel: BuildSelection, usable: ReadonlySet<string>): BuildSelection {
  const map = toMap(sel);
  const kept = new Map([...map].filter(([, id]) => usable.has(id)));
  return kept.size === map.size ? sel : fromMap(kept);
}
