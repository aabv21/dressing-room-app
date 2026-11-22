/** @jest-environment node */
// supabase/functions/_shared/__tests__/buyCheck.test.ts
import {
  buyVerdict,
  candidateGarment,
  compareWithCloset,
  findDuplicates,
  HIGH_NEW_OUTFITS,
  LOW_NEW_OUTFITS,
  MAX_DUPLICATES,
} from '../buyCheck.ts';
import type { GarmentCategory } from '../catalog.ts';
import type { GarmentAttributes } from '../extraction.ts';
import { pieceGain, wardrobeOf } from '../forYou.ts';
import type { RuleGarment } from '../outfitRules.ts';

let nextId = 0;
function garment(category: GarmentCategory, overrides: Partial<RuleGarment> = {}): RuleGarment {
  nextId += 1;
  return {
    id: `g${String(nextId).padStart(3, '0')}`,
    category,
    colors: ['white'],
    pattern: 'solid',
    formality: 2,
    seasons: [],
    warmth: 1,
    fit: 'regular',
    status: 'available',
    last_worn_at: null,
    wear_count: 0,
    suggest: true,
    updated_at: '2026-11-01T00:00:00Z',
    pinned_on: null,
    ...overrides,
  };
}

const item = (overrides: Partial<GarmentAttributes> = {}): GarmentAttributes => ({
  category: 't_shirt',
  colors: ['white'],
  pattern: 'solid',
  material: 'cotton',
  formality: 2,
  seasons: ['spring', 'summer'],
  warmth: 1,
  fit: 'regular',
  occasions: ['home'],
  ...overrides,
});

describe('findDuplicates', () => {
  it('matches the same category with an overlapping primary color', () => {
    const tee = garment('t_shirt', { colors: ['gray', 'white'] });
    const reverse = garment('t_shirt', { colors: ['white'] });
    expect(findDuplicates(item({ colors: ['white', 'navy'] }), [tee, reverse]).sort()).toEqual([tee.id, reverse.id].sort());
    expect(findDuplicates(item({ colors: ['navy', 'white'] }), [garment('t_shirt', { colors: ['white'] })])).toHaveLength(1);
  });

  it('ignores another category, another primary color, a different known pattern and a donated garment', () => {
    const closet = [
      garment('shirt', { colors: ['white'] }),
      garment('t_shirt', { colors: ['black'] }),
      garment('t_shirt', { colors: ['white'], pattern: 'striped' }),
      garment('t_shirt', { colors: ['white'], status: 'donated' }),
    ];
    expect(findDuplicates(item(), closet)).toEqual([]);
  });

  it('keeps a garment in the laundry, lent or out of suggestions, and an unknown pattern on either side', () => {
    const closet = [
      garment('t_shirt', { status: 'laundry' }),
      garment('t_shirt', { status: 'lent' }),
      garment('t_shirt', { suggest: false, pattern: null }),
    ];
    expect(findDuplicates(item(), closet)).toHaveLength(3);
    expect(findDuplicates(item({ pattern: null }), [garment('t_shirt', { pattern: 'striped' })])).toHaveLength(1);
  });

  it('has none without a known color', () => {
    expect(findDuplicates(item({ colors: [] }), [garment('t_shirt')])).toEqual([]);
  });

  it(`orders the closest first and keeps at most ${String(MAX_DUPLICATES)}`, () => {
    const secondaryOnly = garment('t_shirt', { colors: ['gray', 'white'] });
    const unknownPattern = garment('t_shirt', { pattern: null });
    const farFormality = garment('t_shirt', { formality: 5 });
    const exact = garment('t_shirt');
    const extra = garment('t_shirt', { colors: ['black', 'white'] });
    const ids = findDuplicates(item(), [secondaryOnly, unknownPattern, farFormality, extra, exact]);
    expect(ids).toEqual([exact.id, farFormality.id, unknownPattern.id]);
  });
});

describe('buyVerdict', () => {
  it('skips a duplicate that opens few outfits', () => {
    expect(buyVerdict(1, 0)).toBe('skip');
    expect(buyVerdict(2, LOW_NEW_OUTFITS)).toBe('skip');
  });

  it('buys with no duplicate and many new outfits', () => {
    expect(buyVerdict(0, HIGH_NEW_OUTFITS)).toBe('buy');
    expect(buyVerdict(0, 500)).toBe('buy');
  });

  it('thinks it over otherwise', () => {
    expect(buyVerdict(1, LOW_NEW_OUTFITS + 1)).toBe('think');
    expect(buyVerdict(1, 400)).toBe('think');
    expect(buyVerdict(0, HIGH_NEW_OUTFITS - 1)).toBe('think');
    expect(buyVerdict(0, 0)).toBe('think');
  });
});

describe('pieceGain', () => {
  it('counts every complete outfit a candidate pair of shoes finishes, and the pieces in them', () => {
    const closet = [
      garment('t_shirt', { colors: ['black'] }),
      garment('shirt', { colors: ['gray'] }),
      garment('jeans', { colors: ['navy'] }),
      garment('pants', { colors: ['beige'] }),
      garment('dress', { colors: ['red'] }),
      // Outerwear layers over an outfit; for shoes it fills no slot.
      garment('blazer', { formality: 3 }),
    ];
    const sneakers = candidateGarment(item({ category: 'sneakers', colors: ['white'] }));
    // 2 tops × 2 bottoms, plus the dress.
    expect(pieceGain(sneakers, closet, { season: null })).toEqual({ newOutfits: 5, combinesWith: 5 });
  });

  it('is zero for a piece with no category', () => {
    expect(pieceGain(candidateGarment(item({ category: null })), [garment('jeans'), garment('sneakers')], { season: null })).toEqual({
      newOutfits: 0,
      combinesWith: 0,
    });
  });
});

describe('compareWithCloset', () => {
  const tops = (): RuleGarment[] => [garment('t_shirt', { colors: ['black'] }), garment('shirt', { colors: ['gray'] }), garment('sweater', { colors: ['navy'] })];
  const shoes = (): RuleGarment[] => [garment('sneakers'), garment('boots', { colors: ['brown'] }), garment('loafers', { colors: ['black'] })];

  it('counts the new outfits with every season and the wardrobe treated as available', () => {
    const closet = [...tops(), ...shoes(), garment('t_shirt', { status: 'laundry', colors: ['beige'] }), garment('t_shirt', { status: 'donated', colors: ['cream'] })];
    const jeans = item({ category: 'jeans', colors: ['navy'], seasons: ['winter'] });
    const result = compareWithCloset(jeans, closet);
    // 4 tops (the laundry one counts, the donated one doesn't) × 3 shoes, whatever today's season.
    expect(result.newOutfits).toBe(12);
    expect(result.newOutfits).toBe(pieceGain(candidateGarment(jeans), wardrobeOf(closet), { season: null }).newOutfits);
    expect(result.duplicates).toEqual([]);
    expect(result.verdict).toBe('buy');
  });

  it('leaves an unsuggested garment out of the new outfits but keeps it as a duplicate', () => {
    const hidden = garment('jeans', { colors: ['navy'], suggest: false });
    const closet = [garment('t_shirt', { colors: ['black'], suggest: false }), garment('shirt', { colors: ['gray'] }), garment('sneakers'), hidden];
    const result = compareWithCloset(item({ category: 'jeans', colors: ['navy'] }), closet);
    expect(result.newOutfits).toBe(1);
    expect(result.duplicates).toEqual([{ id: hidden.id }]);
    expect(result.verdict).toBe('skip');
  });

  it('thinks it over when a duplicate still opens many outfits', () => {
    const owned = garment('jeans', { colors: ['navy'] });
    const result = compareWithCloset(item({ category: 'jeans', colors: ['navy'] }), [...tops(), ...shoes(), owned]);
    expect(result.duplicates).toEqual([{ id: owned.id }]);
    expect(result.newOutfits).toBe(9);
    expect(result.verdict).toBe('think');
  });

  it('opens nothing in an empty closet', () => {
    expect(compareWithCloset(item(), [])).toEqual({ duplicates: [], newOutfits: 0, verdict: 'think' });
  });
});
