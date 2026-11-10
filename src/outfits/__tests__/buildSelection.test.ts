import type { GarmentCategory } from '../../closet/catalog';
import { canRate, retainSelection, selectGarment, selectionIds, type BuildSelection } from '../buildSelection';

const blouse = { id: 'blouse', category: 'blouse' as const };
const tee = { id: 'tee', category: 't_shirt' as const };
const skirt = { id: 'skirt', category: 'skirt' as const };
const dress = { id: 'dress', category: 'dress' as const };
const sneakers = { id: 'sneakers', category: 'sneakers' as const };
const blazer = { id: 'blazer', category: 'blazer' as const };
const bag = { id: 'bag', category: 'bag' as const };
const hat = { id: 'hat', category: 'hat' as const };
const scarf = { id: 'scarf', category: 'scarf' as const };

function pick(...garments: { id: string; category: GarmentCategory | null }[]): BuildSelection {
  return garments.reduce<BuildSelection>((sel, garment) => selectGarment(sel, garment), {});
}

describe('selectGarment', () => {
  test('puts a garment in its slot, replacing the one there', () => {
    expect(pick(blouse)).toEqual({ top: 'blouse' });
    expect(pick(blouse, tee)).toEqual({ top: 'tee' });
  });

  test('a dress clears a chosen top and bottom', () => {
    expect(pick(blouse, skirt, sneakers, dress)).toEqual({ one_piece: 'dress', shoes: 'sneakers' });
  });

  test('a top clears a dress, and so does a bottom', () => {
    expect(pick(dress, sneakers, blouse)).toEqual({ top: 'blouse', shoes: 'sneakers' });
    expect(pick(dress, skirt)).toEqual({ bottom: 'skirt' });
  });

  test('re-tapping the chosen garment clears its slot', () => {
    expect(pick(blouse, skirt, blouse)).toEqual({ bottom: 'skirt' });
    expect(pick(dress, dress)).toEqual({});
  });

  test('keeps one accessory: a bag, a hat or an accessory replaces the others', () => {
    expect(pick(bag, scarf)).toEqual({ accessory: 'scarf' });
    expect(pick(scarf, hat)).toEqual({ headwear: 'hat' });
    expect(pick(blazer, hat, bag)).toEqual({ outerwear: 'blazer', bag: 'bag' });
  });

  test('ignores a garment with no category', () => {
    const sel = pick(blouse);
    expect(selectGarment(sel, { id: 'unknown', category: null })).toBe(sel);
  });

  test('never holds more than five pieces', () => {
    expect(selectionIds(pick(blouse, skirt, blazer, sneakers, bag, hat, scarf))).toHaveLength(5);
  });
});

describe('canRate', () => {
  test('is false for top + bottom', () => {
    expect(canRate(pick(blouse, skirt))).toBe(false);
  });

  test('is true for top + bottom + shoes and for dress + shoes', () => {
    expect(canRate(pick(blouse, skirt, sneakers))).toBe(true);
    expect(canRate(pick(dress, sneakers))).toBe(true);
  });

  test('is false for a dress alone, and for shoes with only a top', () => {
    expect(canRate(pick(dress))).toBe(false);
    expect(canRate(pick(blouse, sneakers))).toBe(false);
  });
});

describe('selectionIds', () => {
  test('lists the ids in slot order', () => {
    expect(selectionIds(pick(sneakers, bag, skirt, blouse, blazer))).toEqual(['blouse', 'skirt', 'blazer', 'sneakers', 'bag']);
  });

  test('is empty for an empty selection', () => {
    expect(selectionIds({})).toEqual([]);
  });
});

describe('retainSelection', () => {
  test('drops pieces that are no longer usable and keeps the same object otherwise', () => {
    const sel = pick(blouse, skirt, sneakers);
    expect(retainSelection(sel, new Set(['blouse', 'sneakers']))).toEqual({ top: 'blouse', shoes: 'sneakers' });
    expect(retainSelection(sel, new Set(['blouse', 'skirt', 'sneakers', 'other']))).toBe(sel);
  });
});
