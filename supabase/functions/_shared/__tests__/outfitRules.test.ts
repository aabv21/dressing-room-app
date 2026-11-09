/** @jest-environment node */
// supabase/functions/_shared/__tests__/outfitRules.test.ts
import type { WeatherSummary } from '../weather.ts';
import {
  FORMALITY_RANGE,
  generateCandidates,
  isCompleteOutfit,
  missingSlots,
  passesRules,
  preScore,
  type RuleContext,
  type RuleGarment,
  seasonOf,
  wornThisWeek,
} from '../outfitRules.ts';

const TODAY = '2026-11-08';

let nextId = 0;

/** A minimal, valid `available` garment; override only what a test needs. */
function garment(overrides: Partial<RuleGarment> = {}): RuleGarment {
  nextId += 1;
  return {
    id: `g${String(nextId)}`,
    category: 't_shirt',
    colors: ['white'],
    pattern: 'solid',
    formality: 2,
    seasons: [],
    warmth: 1,
    fit: 'regular',
    status: 'available',
    last_worn_at: null,
    updated_at: '2026-01-01T00:00:00Z',
    pinned_on: null,
    ...overrides,
  };
}

const MILD_CTX: RuleContext = { occasion: null, season: 'summer', weather: null, today: TODAY };

function weather(overrides: Partial<WeatherSummary> = {}): WeatherSummary {
  return { tempC: 20, condition: 'clear', band: 'mild', rain: false, ...overrides };
}

describe('seasonOf', () => {
  test('January in the southern hemisphere is summer', () => {
    expect(seasonOf('2026-01-15', -34.6)).toBe('summer');
  });

  test('January in the northern hemisphere is winter', () => {
    expect(seasonOf('2026-01-15', 40)).toBe('winter');
  });

  test('a null latitude defaults to the northern hemisphere', () => {
    expect(seasonOf('2026-01-15', null)).toBe('winter');
  });
});

describe('isCompleteOutfit', () => {
  test('top, bottom and shoes is complete', () => {
    expect(isCompleteOutfit(['top', 'bottom', 'shoes'])).toBe(true);
  });

  test('one_piece and shoes is complete', () => {
    expect(isCompleteOutfit(['one_piece', 'shoes'])).toBe(true);
  });

  test('missing shoes is incomplete', () => {
    expect(isCompleteOutfit(['top', 'bottom'])).toBe(false);
  });

  test('top and shoes with no bottom is incomplete', () => {
    expect(isCompleteOutfit(['top', 'shoes'])).toBe(false);
  });
});

describe('missingSlots', () => {
  test('only tops leaves bottom and shoes missing', () => {
    const garments = [garment({ category: 't_shirt' })];
    expect(missingSlots(garments)).toEqual(['bottom', 'shoes']);
  });

  test('a dress plus sneakers has nothing missing', () => {
    const garments = [garment({ category: 'dress' }), garment({ category: 'sneakers' })];
    expect(missingSlots(garments)).toEqual([]);
  });

  test('everything in laundry leaves all three missing', () => {
    const garments = [
      garment({ category: 't_shirt', status: 'laundry' }),
      garment({ category: 'jeans', status: 'laundry' }),
      garment({ category: 'sneakers', status: 'laundry' }),
    ];
    expect(missingSlots(garments)).toEqual(['top', 'bottom', 'shoes']);
  });

  test('an empty closet is missing everything, in slot order', () => {
    expect(missingSlots([])).toEqual(['top', 'bottom', 'shoes']);
  });
});

describe('FORMALITY_RANGE', () => {
  test('covers every occasion plus any', () => {
    expect(FORMALITY_RANGE.office).toEqual([3, 5]);
    expect(FORMALITY_RANGE.university).toEqual([1, 4]);
    expect(FORMALITY_RANGE.going_out).toEqual([2, 5]);
    expect(FORMALITY_RANGE.home).toEqual([1, 3]);
    expect(FORMALITY_RANGE.event).toEqual([4, 5]);
    expect(FORMALITY_RANGE.sport).toEqual([1, 2]);
    expect(FORMALITY_RANGE.any).toEqual([1, 5]);
  });
});

describe('passesRules', () => {
  test('rejects a coat when hot', () => {
    const outfit = [
      garment({ category: 't_shirt' }),
      garment({ category: 'shorts' }),
      garment({ category: 'sneakers' }),
      garment({ category: 'coat' }),
    ];
    const ctx: RuleContext = { ...MILD_CTX, weather: weather({ band: 'hot' }) };
    expect(passesRules(outfit, ctx)).toBe(false);
  });

  test('rejects warmth 3 pieces when hot', () => {
    const outfit = [
      garment({ category: 'sweater', warmth: 3 }),
      garment({ category: 'jeans' }),
      garment({ category: 'sneakers' }),
    ];
    const ctx: RuleContext = { ...MILD_CTX, weather: weather({ band: 'hot' }) };
    expect(passesRules(outfit, ctx)).toBe(false);
  });

  test('rejects a cold-weather outfit with no outerwear', () => {
    const outfit = [garment({ category: 't_shirt' }), garment({ category: 'jeans' }), garment({ category: 'boots' })];
    const ctx: RuleContext = { ...MILD_CTX, weather: weather({ band: 'cold' }) };
    expect(passesRules(outfit, ctx)).toBe(false);
  });

  test('accepts a cold-weather outfit with outerwear', () => {
    const outfit = [
      garment({ category: 't_shirt' }),
      garment({ category: 'jeans' }),
      garment({ category: 'boots' }),
      garment({ category: 'coat' }),
    ];
    const ctx: RuleContext = { ...MILD_CTX, weather: weather({ band: 'cold' }) };
    expect(passesRules(outfit, ctx)).toBe(true);
  });

  test('rejects a cold outfit without outerwear when outerwearAvailable is true', () => {
    const outfit = [garment({ category: 't_shirt' }), garment({ category: 'jeans' }), garment({ category: 'boots' })];
    const ctx: RuleContext = { ...MILD_CTX, weather: weather({ band: 'cold' }), outerwearAvailable: true };
    expect(passesRules(outfit, ctx)).toBe(false);
  });

  test('rejects a cold outfit without outerwear when outerwearAvailable is unset (defaults true)', () => {
    const outfit = [garment({ category: 't_shirt' }), garment({ category: 'jeans' }), garment({ category: 'boots' })];
    const ctx: RuleContext = { ...MILD_CTX, weather: weather({ band: 'cold' }) };
    expect(ctx.outerwearAvailable).toBeUndefined();
    expect(passesRules(outfit, ctx)).toBe(false);
  });

  test('accepts a cold outfit without outerwear when outerwearAvailable is false', () => {
    const outfit = [garment({ category: 't_shirt' }), garment({ category: 'jeans' }), garment({ category: 'boots' })];
    const ctx: RuleContext = { ...MILD_CTX, weather: weather({ band: 'cold' }), outerwearAvailable: false };
    expect(passesRules(outfit, ctx)).toBe(true);
  });

  test('rejects formality 1 for event', () => {
    const outfit = [
      garment({ category: 't_shirt', formality: 1 }),
      garment({ category: 'jeans', formality: 1 }),
      garment({ category: 'sneakers', formality: 1 }),
    ];
    const ctx: RuleContext = { ...MILD_CTX, occasion: 'event' };
    expect(passesRules(outfit, ctx)).toBe(false);
  });

  test('rejects a winter-only item in summer', () => {
    const outfit = [
      garment({ category: 'sweater', seasons: ['winter'] }),
      garment({ category: 'jeans' }),
      garment({ category: 'sneakers' }),
    ];
    const ctx: RuleContext = { ...MILD_CTX, season: 'summer' };
    expect(passesRules(outfit, ctx)).toBe(false);
  });

  test('accepts an item with empty seasons in any season', () => {
    const outfit = [garment({ seasons: [] }), garment({ category: 'jeans' }), garment({ category: 'sneakers' })];
    expect(passesRules(outfit, MILD_CTX)).toBe(true);
  });

  test('rejects 4 non-neutral colors', () => {
    const outfit = [
      garment({ colors: ['red', 'green'] }),
      garment({ category: 'jeans', colors: ['blue', 'purple'] }),
      garment({ category: 'sneakers' }),
    ];
    expect(passesRules(outfit, MILD_CTX)).toBe(false);
  });

  test('accepts 3 non-neutral colors plus neutrals', () => {
    const outfit = [
      garment({ colors: ['red', 'green', 'black'] }),
      garment({ category: 'jeans', colors: ['blue', 'navy'] }),
      garment({ category: 'sneakers' }),
    ];
    expect(passesRules(outfit, MILD_CTX)).toBe(true);
  });

  test('rejects striped plus floral', () => {
    const outfit = [
      garment({ pattern: 'striped' }),
      garment({ category: 'jeans', pattern: 'floral' }),
      garment({ category: 'sneakers' }),
    ];
    expect(passesRules(outfit, MILD_CTX)).toBe(false);
  });

  test('accepts one non-solid pattern', () => {
    const outfit = [
      garment({ pattern: 'striped' }),
      garment({ category: 'jeans', pattern: 'solid' }),
      garment({ category: 'sneakers' }),
    ];
    expect(passesRules(outfit, MILD_CTX)).toBe(true);
  });

  test('rejects a garment that is not available', () => {
    const outfit = [
      garment({ status: 'laundry' }),
      garment({ category: 'jeans' }),
      garment({ category: 'sneakers' }),
    ];
    expect(passesRules(outfit, MILD_CTX)).toBe(false);
  });

  test('rejects a donated garment', () => {
    const outfit = [
      garment({ status: 'donated' }),
      garment({ category: 'jeans' }),
      garment({ category: 'sneakers' }),
    ];
    expect(passesRules(outfit, MILD_CTX)).toBe(false);
  });

  test('rejects a garment with no category', () => {
    const outfit = [garment({ category: null }), garment({ category: 'jeans' }), garment({ category: 'sneakers' })];
    expect(passesRules(outfit, MILD_CTX)).toBe(false);
  });

  test('rejects formality outside the range when an occasion is set', () => {
    const outfit = [
      garment({ formality: 5 }),
      garment({ category: 'jeans', formality: 5 }),
      garment({ category: 'sneakers', formality: 5 }),
    ];
    const ctx: RuleContext = { ...MILD_CTX, occasion: 'home' };
    expect(passesRules(outfit, ctx)).toBe(false);
  });

  test('accepts null formality regardless of occasion', () => {
    const outfit = [
      garment({ formality: null }),
      garment({ category: 'jeans', formality: null }),
      garment({ category: 'sneakers', formality: null }),
    ];
    const ctx: RuleContext = { ...MILD_CTX, occasion: 'event' };
    expect(passesRules(outfit, ctx)).toBe(true);
  });
});

describe('preScore', () => {
  test('never worn scores 30 days', () => {
    const outfit = [garment({ last_worn_at: null, colors: ['red'] })];
    expect(preScore(outfit, TODAY)).toBe(30);
  });

  test('worn 2 days ago scores 2 days plus neutral bonus for a neutral color', () => {
    const outfit = [garment({ last_worn_at: '2026-11-06T00:00:00Z', colors: ['black'] })];
    expect(preScore(outfit, TODAY)).toBe(2 + 5);
  });

  test('days since last worn is capped at 30', () => {
    const outfit = [garment({ last_worn_at: '2025-01-01T00:00:00Z', colors: ['red'] })];
    expect(preScore(outfit, TODAY)).toBe(30);
  });

  test('averages across the base pieces, so a one-piece outfit is not behind for having fewer pieces', () => {
    const outfit = [
      garment({ last_worn_at: null, colors: ['red'] }),
      garment({ category: 'jeans', last_worn_at: '2026-11-06T00:00:00Z', colors: ['navy'] }),
    ];
    expect(preScore(outfit, TODAY)).toBe((30 + 2 + 5) / 2);
    const dress = [garment({ category: 'dress', colors: ['black'] }), garment({ category: 'sneakers', colors: ['white'] })];
    const separates = [...dress.slice(1), garment({ colors: ['black'] }), garment({ category: 'jeans', colors: ['navy'] })];
    expect(preScore(dress, TODAY)).toBe(preScore(separates, TODAY));
  });

  test('an extra adds nothing, neutral or not', () => {
    const base = [garment({ colors: ['red'] }), garment({ category: 'jeans', colors: ['navy'] }), garment({ category: 'sneakers' })];
    for (const extra of [garment({ category: 'belt', colors: ['black'] }), garment({ category: 'bag', colors: ['red'] }), garment({ category: 'hat' })]) {
      expect(preScore([...base, extra], TODAY)).toBe(preScore(base, TODAY));
    }
  });

  test('outerwear counts as a base piece', () => {
    const base = [garment({ colors: ['red'] }), garment({ category: 'jeans', colors: ['red'] }), garment({ category: 'sneakers', colors: ['red'] })];
    expect(preScore([...base, garment({ category: 'coat', colors: ['black'] })], TODAY)).toBe((30 * 4 + 5) / 4);
  });

  test('an outfit of extras only (a single swap candidate) scores those pieces', () => {
    expect(preScore([garment({ category: 'belt', colors: ['black'], last_worn_at: '2026-11-06T00:00:00Z' })], TODAY)).toBe(2 + 5);
    expect(preScore([], TODAY)).toBe(0);
  });
});

describe('wornThisWeek', () => {
  test('a piece worn 2 days ago counts as this week', () => {
    const outfit = [garment({ last_worn_at: '2026-11-06T00:00:00Z' })];
    expect(wornThisWeek(outfit, TODAY)).toBe(true);
  });

  test('a piece worn 10 days ago does not count', () => {
    const outfit = [garment({ last_worn_at: '2026-10-29T00:00:00Z' })];
    expect(wornThisWeek(outfit, TODAY)).toBe(false);
  });

  test('never worn does not count', () => {
    const outfit = [garment({ last_worn_at: null })];
    expect(wornThisWeek(outfit, TODAY)).toBe(false);
  });

  test('exactly 7 days ago is not recent (the window is [0, 7))', () => {
    const outfit = [garment({ last_worn_at: '2026-11-01T00:00:00Z' })];
    expect(wornThisWeek(outfit, TODAY)).toBe(false);
  });

  test('6 days ago is still recent', () => {
    const outfit = [garment({ last_worn_at: '2026-11-02T00:00:00Z' })];
    expect(wornThisWeek(outfit, TODAY)).toBe(true);
  });

  test('the boundary is by calendar day: late on day 7 is not recent, late on day 6 is', () => {
    expect(wornThisWeek([garment({ last_worn_at: '2026-11-01T23:59:59Z' })], TODAY)).toBe(false);
    expect(wornThisWeek([garment({ last_worn_at: '2026-11-02T23:59:59Z' })], TODAY)).toBe(true);
  });

  test('worn today counts as this week', () => {
    expect(wornThisWeek([garment({ last_worn_at: `${TODAY}T08:00:00Z` })], TODAY)).toBe(true);
  });
});

describe('generateCandidates', () => {
  function basicCloset(): RuleGarment[] {
    return [
      garment({ category: 't_shirt', colors: ['white'] }),
      garment({ category: 'shirt', colors: ['blue'] }),
      garment({ category: 'sweater', colors: ['black'] }),
      garment({ category: 'jeans', colors: ['navy'] }),
      garment({ category: 'pants', colors: ['beige'] }),
      garment({ category: 'shorts', colors: ['white'] }),
      garment({ category: 'sneakers', colors: ['white'] }),
      garment({ category: 'boots', colors: ['brown'] }),
    ];
  }

  test('is deterministic for the same seed', () => {
    const closet = basicCloset();
    const a = generateCandidates(closet, MILD_CTX, 'user1:2026-11-08');
    const b = generateCandidates(closet, MILD_CTX, 'user1:2026-11-08');
    expect(a.map((outfit) => outfit.map((item) => item.id))).toEqual(b.map((outfit) => outfit.map((item) => item.id)));
  });

  test('a different seed can produce a different order', () => {
    const closet = basicCloset();
    const a = generateCandidates(closet, MILD_CTX, 'seed-a');
    const b = generateCandidates(closet, MILD_CTX, 'seed-b');
    expect(a.map((outfit) => outfit.map((item) => item.id))).not.toEqual(
      b.map((outfit) => outfit.map((item) => item.id)),
    );
  });

  test('returns at most limit candidates', () => {
    const closet = basicCloset();
    const result = generateCandidates(closet, MILD_CTX, 'seed', 5);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  test('every candidate passes the rules and contains shoes', () => {
    const closet = basicCloset();
    const result = generateCandidates(closet, MILD_CTX, 'seed');
    expect(result.length).toBeGreaterThan(0);
    for (const outfit of result) {
      expect(passesRules(outfit, MILD_CTX)).toBe(true);
      expect(outfit.some((item) => item.category !== null && item.category === 'sneakers' || item.category === 'boots')).toBe(
        true,
      );
    }
  });

  test('does not explode on a large closet and still stops at limit', () => {
    const closet: RuleGarment[] = [];
    for (let i = 0; i < 40; i += 1) {
      closet.push(garment({ category: 't_shirt', colors: ['white'] }));
      closet.push(garment({ category: 'jeans', colors: ['navy'] }));
      closet.push(garment({ category: 'sneakers', colors: ['white'] }));
    }
    const start = Date.now();
    const result = generateCandidates(closet, MILD_CTX, 'seed', 200);
    const elapsed = Date.now() - start;
    expect(result.length).toBeLessThanOrEqual(200);
    expect(elapsed).toBeLessThan(2000);
  });

  /** 10 tops, 8 bottoms, 5 shoes, 3 dresses and 4 extras, every one never worn. */
  function varietyCloset(): RuleGarment[] {
    const neutrals = ['white', 'black', 'gray', 'navy', 'beige'] as const;
    const many = (category: RuleGarment['category'], count: number): RuleGarment[] =>
      Array.from({ length: count }, (_, i) => garment({ category, colors: [neutrals[i % neutrals.length] ?? 'white'] }));
    return [
      ...many('t_shirt', 10),
      ...many('jeans', 8),
      ...many('sneakers', 5),
      ...many('dress', 3),
      ...many('belt', 2),
      ...many('bag', 2),
    ];
  }

  const slotIds = (outfits: readonly (readonly RuleGarment[])[], categories: readonly string[]): Set<string> =>
    new Set(outfits.flatMap((outfit) => outfit.filter((item) => categories.includes(item.category ?? '')).map((item) => item.id)));

  test('spreads over the closet: the first 30 candidates use many shoes and tops, and some dresses', () => {
    const first30 = generateCandidates(varietyCloset(), MILD_CTX, 'user1:2026-11-08').slice(0, 30);
    expect(first30).toHaveLength(30);
    expect(slotIds(first30, ['sneakers']).size).toBeGreaterThanOrEqual(3);
    expect(slotIds(first30, ['t_shirt']).size).toBeGreaterThanOrEqual(5);
    expect(first30.some((outfit) => outfit.some((item) => item.category === 'dress'))).toBe(true);
  });

  test('a one-piece is drawn in proportion to availability: about 3 / (9 + 3) of the candidates', () => {
    const result = generateCandidates(varietyCloset(), MILD_CTX, 'seed');
    const dresses = result.filter((outfit) => outfit.some((item) => item.category === 'dress')).length;
    expect(result).toHaveLength(200);
    expect(dresses).toBeGreaterThan(200 * 0.15);
    expect(dresses).toBeLessThan(200 * 0.35);
  });

  test('"none" weighs as much as every extra together, and an outfit has at most one extra', () => {
    const result = generateCandidates(varietyCloset(), MILD_CTX, 'seed');
    const extrasPer = result.map((outfit) => outfit.filter((item) => item.category === 'belt' || item.category === 'bag').length);
    expect(Math.max(...extrasPer)).toBe(1);
    const without = extrasPer.filter((extras) => extras === 0).length;
    expect(without).toBeGreaterThan(200 * 0.35);
    expect(without).toBeLessThan(200 * 0.65);
  });

  test('candidates are distinct', () => {
    const result = generateCandidates(varietyCloset(), MILD_CTX, 'seed');
    const keys = result.map((outfit) => outfit.map((item) => item.id).sort().join(','));
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('a closet with fewer possible outfits than the limit returns each one once, after a bounded number of draws', () => {
    const closet = [garment({ category: 't_shirt' }), garment({ category: 'jeans', colors: ['navy'] }), garment({ category: 'sneakers' })];
    const start = Date.now();
    const result = generateCandidates(closet, MILD_CTX, 'seed');
    expect(result).toHaveLength(1);
    expect(Date.now() - start).toBeLessThan(500);
  });

  test('one formal outfit in a 200-garment casual closet is found on every seed for an event', () => {
    const closet: RuleGarment[] = [];
    for (let i = 0; i < 50; i += 1) {
      closet.push(garment({ category: 't_shirt', colors: ['black'] }), garment({ category: 'jeans', colors: ['navy'] }));
      closet.push(garment({ category: 'sneakers', colors: ['white'] }), garment({ category: 'bag', colors: ['black'] }));
    }
    const shirt = garment({ category: 'shirt', formality: 4 });
    const pants = garment({ category: 'pants', colors: ['black'], formality: 4 });
    const loafers = garment({ category: 'loafers', colors: ['black'], formality: 4 });
    closet.push(shirt, pants, loafers);
    const ctx: RuleContext = { ...MILD_CTX, occasion: 'event' };
    for (let seed = 0; seed < 20; seed += 1) {
      const result = generateCandidates(closet, ctx, `user:${String(seed)}`);
      expect(result.map((outfit) => outfit.map((item) => item.id).sort())).toEqual([[shirt.id, pants.id, loafers.id].sort()]);
    }
  });

  test('on a hot day the pools hold no outerwear and no warmth-3 piece, so draws are not wasted on them', () => {
    const closet = [
      garment({ category: 't_shirt' }),
      ...Array.from({ length: 30 }, () => garment({ category: 'sweater', warmth: 3 })),
      garment({ category: 'shorts', colors: ['navy'] }),
      ...Array.from({ length: 30 }, () => garment({ category: 'sneakers', warmth: 3 })),
      garment({ category: 'sandals' }),
    ];
    const ctx: RuleContext = { ...MILD_CTX, weather: weather({ band: 'hot' }) };
    for (let seed = 0; seed < 20; seed += 1) {
      expect(generateCandidates(closet, ctx, `hot:${String(seed)}`, 5)).toHaveLength(1);
    }
  });

  test('excludes an item worn 2 days ago when 3+ alternatives exist', () => {
    const recentShoes = garment({ category: 'sneakers', colors: ['white'], last_worn_at: '2026-11-06T00:00:00Z' });
    const closet = [
      garment({ category: 't_shirt', colors: ['white'] }),
      garment({ category: 'jeans', colors: ['navy'] }),
      recentShoes,
      garment({ category: 'boots', colors: ['brown'] }),
      garment({ category: 'flats', colors: ['beige'] }),
      garment({ category: 'loafers', colors: ['brown'] }),
    ];
    const result = generateCandidates(closet, MILD_CTX, 'seed');
    const usedRecent = result.some((outfit) => outfit.some((item) => item.id === recentShoes.id));
    expect(usedRecent).toBe(false);
  });

  test('an item worn exactly 7 days ago is not avoided, even with 3+ alternatives', () => {
    const weekOldShoes = garment({ category: 'sneakers', colors: ['white'], last_worn_at: '2026-11-01T12:00:00Z' });
    const closet = [
      garment({ category: 't_shirt', colors: ['white'] }),
      garment({ category: 'jeans', colors: ['navy'] }),
      weekOldShoes,
      garment({ category: 'boots', colors: ['brown'] }),
      garment({ category: 'flats', colors: ['beige'] }),
      garment({ category: 'loafers', colors: ['brown'] }),
    ];
    const result = generateCandidates(closet, MILD_CTX, 'seed');
    expect(result.some((outfit) => outfit.some((item) => item.id === weekOldShoes.id))).toBe(true);
  });

  test('includes a recently-worn item when it is the only shoes', () => {
    const recentShoes = garment({ category: 'sneakers', colors: ['white'], last_worn_at: '2026-11-06T00:00:00Z' });
    const closet = [garment({ category: 't_shirt', colors: ['white'] }), garment({ category: 'jeans', colors: ['navy'] }), recentShoes];
    const result = generateCandidates(closet, MILD_CTX, 'seed');
    expect(result.length).toBeGreaterThan(0);
    const usedRecent = result.some((outfit) => outfit.some((item) => item.id === recentShoes.id));
    expect(usedRecent).toBe(true);
  });

  test('a cold day with no available outerwear in the closet still returns candidates, none with outerwear', () => {
    const closet = [
      garment({ category: 't_shirt', colors: ['white'] }),
      garment({ category: 'jeans', colors: ['navy'] }),
      garment({ category: 'sneakers', colors: ['white'] }),
    ];
    const ctx: RuleContext = { ...MILD_CTX, weather: weather({ band: 'cold' }) };
    const result = generateCandidates(closet, ctx, 'seed');
    expect(result.length).toBeGreaterThan(0);
    for (const outfit of result) {
      expect(outfit.every((item) => item.category === null || item.category !== 'coat')).toBe(true);
    }
  });

  test('a rainy, non-hot day with no available outerwear still returns candidates', () => {
    const closet = [
      garment({ category: 't_shirt', colors: ['white'] }),
      garment({ category: 'jeans', colors: ['navy'] }),
      garment({ category: 'sneakers', colors: ['white'] }),
    ];
    const ctx: RuleContext = { ...MILD_CTX, weather: weather({ band: 'mild', rain: true }) };
    const result = generateCandidates(closet, ctx, 'seed');
    expect(result.length).toBeGreaterThan(0);
  });

  test('a rainy, non-hot day with outerwear available puts it in every candidate', () => {
    const closet = [
      garment({ category: 't_shirt', colors: ['white'] }),
      garment({ category: 'jeans', colors: ['navy'] }),
      garment({ category: 'sneakers', colors: ['white'] }),
      garment({ category: 'coat', colors: ['black'] }),
    ];
    const ctx: RuleContext = { ...MILD_CTX, weather: weather({ band: 'mild', rain: true }) };
    const result = generateCandidates(closet, ctx, 'seed');
    expect(result.length).toBeGreaterThan(0);
    for (const outfit of result) {
      expect(outfit.some((item) => item.category === 'coat')).toBe(true);
    }
  });

  test('the only coat is the wrong formality for the occasion on a cold day: candidates are returned without it', () => {
    const closet = [
      garment({ category: 't_shirt', colors: ['white'], formality: 1 }),
      garment({ category: 'jeans', colors: ['navy'], formality: 1 }),
      garment({ category: 'sneakers', colors: ['white'], formality: 1 }),
      garment({ category: 'coat', colors: ['black'], formality: 5 }),
    ];
    const ctx: RuleContext = { ...MILD_CTX, occasion: 'sport', weather: weather({ band: 'cold' }) };
    const result = generateCandidates(closet, ctx, 'seed');
    expect(result.length).toBeGreaterThan(0);
    for (const outfit of result) {
      expect(outfit.every((item) => item.category !== 'coat')).toBe(true);
    }
  });

  test('the only coat is out of season on a rainy, non-hot day: candidates are returned without it', () => {
    const closet = [
      garment({ category: 't_shirt', colors: ['white'] }),
      garment({ category: 'jeans', colors: ['navy'] }),
      garment({ category: 'sneakers', colors: ['white'] }),
      garment({ category: 'coat', colors: ['black'], seasons: ['winter'] }),
    ];
    const ctx: RuleContext = { ...MILD_CTX, season: 'summer', weather: weather({ band: 'mild', rain: true }) };
    const result = generateCandidates(closet, ctx, 'seed');
    expect(result.length).toBeGreaterThan(0);
    for (const outfit of result) {
      expect(outfit.every((item) => item.category !== 'coat')).toBe(true);
    }
  });

  test('one admissible and one inadmissible coat on a cold day: every candidate gets the admissible one', () => {
    const admissibleCoat = garment({ category: 'coat', colors: ['black'], formality: 2 });
    const inadmissibleCoat = garment({ category: 'blazer', colors: ['navy'], formality: 5 });
    const closet = [
      garment({ category: 't_shirt', colors: ['white'], formality: 1 }),
      garment({ category: 'jeans', colors: ['navy'], formality: 1 }),
      garment({ category: 'sneakers', colors: ['white'], formality: 1 }),
      admissibleCoat,
      inadmissibleCoat,
    ];
    const ctx: RuleContext = { ...MILD_CTX, occasion: 'sport', weather: weather({ band: 'cold' }) };
    const result = generateCandidates(closet, ctx, 'seed');
    expect(result.length).toBeGreaterThan(0);
    for (const outfit of result) {
      expect(outfit.some((item) => item.id === admissibleCoat.id)).toBe(true);
      expect(outfit.some((item) => item.id === inadmissibleCoat.id)).toBe(false);
    }
  });

  test('a donated garment is never drawn into a candidate', () => {
    const donatedShoes = garment({ category: 'sneakers', colors: ['white'], status: 'donated' });
    const closet = [
      garment({ category: 't_shirt', colors: ['white'] }),
      garment({ category: 'jeans', colors: ['navy'] }),
      donatedShoes,
      garment({ category: 'boots', colors: ['brown'] }),
    ];
    const result = generateCandidates(closet, MILD_CTX, 'seed');
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((outfit) => outfit.some((item) => item.id === donatedShoes.id))).toBe(false);
  });

  describe('pinnedIds', () => {
    /** 50 tops, 50 bottoms, 50 shoes, 50 bags, every one never worn, so nothing is excluded as recent. */
    function hugeCloset(): RuleGarment[] {
      const neutrals = ['white', 'black', 'gray', 'navy', 'beige'] as const;
      const many = (category: RuleGarment['category'], count: number): RuleGarment[] =>
        Array.from({ length: count }, (_, i) => garment({ category, colors: [neutrals[i % neutrals.length] ?? 'white'] }));
      return [...many('t_shirt', 50), ...many('jeans', 50), ...many('sneakers', 50), ...many('bag', 50)];
    }

    test('a pinned top is found in at least one candidate on every one of 20 seeds (200-garment closet)', () => {
      const closet = hugeCloset();
      const pinned = closet[0];
      if (pinned === undefined) throw new Error('setup');
      for (let seed = 0; seed < 20; seed += 1) {
        const result = generateCandidates(closet, MILD_CTX, `user:${String(seed)}`, 200, [pinned.id]);
        expect(result.some((outfit) => outfit.some((item) => item.id === pinned.id))).toBe(true);
      }
    });

    test('a pinned shoes garment (a required slot with many peers) is found on every one of 20 seeds', () => {
      const closet = hugeCloset();
      const pinned = closet.find((item) => item.category === 'sneakers');
      if (pinned === undefined) throw new Error('setup');
      for (let seed = 0; seed < 20; seed += 1) {
        const result = generateCandidates(closet, MILD_CTX, `user:${String(seed)}`, 200, [pinned.id]);
        expect(result.some((outfit) => outfit.some((item) => item.id === pinned.id))).toBe(true);
      }
    });

    test('a pinned extra (drawn only about half the time) is found on every one of 20 seeds', () => {
      const closet = hugeCloset();
      const pinned = closet.find((item) => item.category === 'bag');
      if (pinned === undefined) throw new Error('setup');
      for (let seed = 0; seed < 20; seed += 1) {
        const result = generateCandidates(closet, MILD_CTX, `user:${String(seed)}`, 200, [pinned.id]);
        expect(result.some((outfit) => outfit.some((item) => item.id === pinned.id))).toBe(true);
      }
    });

    test('an empty pinnedIds array (the default) behaves exactly as before: same candidates for the same seed', () => {
      const closet = basicCloset();
      const withoutArg = generateCandidates(closet, MILD_CTX, 'seed');
      const withEmpty = generateCandidates(closet, MILD_CTX, 'seed', 200, []);
      expect(withoutArg.map((outfit) => outfit.map((item) => item.id))).toEqual(
        withEmpty.map((outfit) => outfit.map((item) => item.id)),
      );
    });

    test('a pinned garment that passes no rule-passing outfit (wrong formality) yields no candidate containing it, but still returns the normal list', () => {
      const closet = [
        garment({ category: 't_shirt', formality: 1 }),
        garment({ category: 'jeans', formality: 1 }),
        garment({ category: 'sneakers', formality: 1 }),
      ];
      const tooFormal = garment({ category: 'blazer', formality: 5 });
      const result = generateCandidates([...closet, tooFormal], { ...MILD_CTX, occasion: 'sport' }, 'seed', 200, [tooFormal.id]);
      expect(result.length).toBeGreaterThan(0);
      expect(result.some((outfit) => outfit.some((item) => item.id === tooFormal.id))).toBe(false);
    });

    // --- a pinned outerwear piece is included on days the weather doesn't require it ------------

    test('a pinned jacket on a mild day (outerwear not required) is reachable: at least one candidate contains it', () => {
      const neutrals = ['white', 'black', 'gray', 'navy', 'beige'] as const;
      const many = (category: RuleGarment['category'], count: number): RuleGarment[] =>
        Array.from({ length: count }, (_, i) => garment({ category, colors: [neutrals[i % neutrals.length] ?? 'white'] }));
      const jacket = garment({ category: 'jacket', colors: ['black'] });
      const closet = [jacket, ...many('t_shirt', 5), ...many('jeans', 5), ...many('sneakers', 3)];
      const mild: RuleContext = { ...MILD_CTX, weather: { tempC: 18, condition: 'clear', band: 'mild', rain: false } };
      const result = generateCandidates(closet, mild, 'u2026-11-08', 200, [jacket.id]);
      expect(result.length).toBeGreaterThan(0);
      expect(result.some((outfit) => outfit.some((item) => item.id === jacket.id))).toBe(true);
    });

    test('a pinned jacket with no weather known is reachable: at least one candidate contains it', () => {
      const neutrals = ['white', 'black', 'gray', 'navy', 'beige'] as const;
      const many = (category: RuleGarment['category'], count: number): RuleGarment[] =>
        Array.from({ length: count }, (_, i) => garment({ category, colors: [neutrals[i % neutrals.length] ?? 'white'] }));
      const jacket = garment({ category: 'jacket', colors: ['black'] });
      const closet = [jacket, ...many('t_shirt', 5), ...many('jeans', 5), ...many('sneakers', 3)];
      const result = generateCandidates(closet, { ...MILD_CTX, weather: null }, 'u2026-11-08', 200, [jacket.id]);
      expect(result.length).toBeGreaterThan(0);
      expect(result.some((outfit) => outfit.some((item) => item.id === jacket.id))).toBe(true);
    });

    test('a pinned jacket on a hot day (fitsAlone rejects outerwear when hot) falls back to the normal list', () => {
      const neutrals = ['white', 'black', 'gray', 'navy', 'beige'] as const;
      const many = (category: RuleGarment['category'], count: number): RuleGarment[] =>
        Array.from({ length: count }, (_, i) => garment({ category, colors: [neutrals[i % neutrals.length] ?? 'white'] }));
      const jacket = garment({ category: 'jacket', colors: ['black'] });
      const closet = [jacket, ...many('t_shirt', 5), ...many('shorts', 5), ...many('sandals', 3)];
      const hot: RuleContext = { ...MILD_CTX, weather: { tempC: 32, condition: 'clear', band: 'hot', rain: false } };
      const pinned = generateCandidates(closet, hot, 'seed', 200, [jacket.id]);
      const plain = generateCandidates(closet, hot, 'seed', 200, []);
      expect(pinned.map((outfit) => outfit.map((item) => item.id))).toEqual(plain.map((outfit) => outfit.map((item) => item.id)));
      expect(pinned.some((outfit) => outfit.some((item) => item.id === jacket.id))).toBe(false);
    });

    // --- M3: the hint is chosen only among admissible pins ---------------------------------------

    test('an inadmissible pin (wrong season) never starves an admissible sibling pin out of 20 seeds', () => {
      const neutrals = ['white', 'black', 'gray', 'navy', 'beige'] as const;
      const many = (category: RuleGarment['category'], count: number): RuleGarment[] =>
        Array.from({ length: count }, (_, i) => garment({ category, colors: [neutrals[i % neutrals.length] ?? 'white'] }));
      const ctx: RuleContext = { ...MILD_CTX, season: 'autumn' };
      for (let seed = 0; seed < 20; seed += 1) {
        const inadmissible = garment({ category: 't_shirt', seasons: ['winter'] }); // excluded in autumn
        const admissible = garment({ category: 't_shirt' });
        const closet = [
          inadmissible,
          admissible,
          ...many('t_shirt', 50),
          ...many('jeans', 50),
          ...many('sneakers', 50),
          ...many('bag', 50),
        ];
        const result = generateCandidates(closet, ctx, `s${String(seed)}`, 200, [inadmissible.id, admissible.id]);
        expect(result.some((outfit) => outfit.some((item) => item.id === admissible.id))).toBe(true);
        expect(result.some((outfit) => outfit.some((item) => item.id === inadmissible.id))).toBe(false);
      }
    });

    // --- M4: an admissible pin is exempt from the 7-day recent-wear exclusion --------------------

    test('a pinned garment worn yesterday still appears, unlike an ordinary recently-worn piece', () => {
      const recentPin = garment({ category: 'sneakers', colors: ['white'], last_worn_at: '2026-11-07T00:00:00Z' });
      const closet = [
        garment({ category: 't_shirt', colors: ['white'] }),
        garment({ category: 'jeans', colors: ['navy'] }),
        recentPin,
        garment({ category: 'boots', colors: ['brown'] }),
        garment({ category: 'flats', colors: ['beige'] }),
        garment({ category: 'loafers', colors: ['brown'] }),
      ];
      const result = generateCandidates(closet, MILD_CTX, 'seed', 200, [recentPin.id]);
      expect(result.some((outfit) => outfit.some((item) => item.id === recentPin.id))).toBe(true);
      // Unpinned, the same recently-worn shoes are excluded while 3+ alternatives exist (existing behavior).
      const unpinned = generateCandidates(closet, MILD_CTX, 'seed', 200, []);
      expect(unpinned.some((outfit) => outfit.some((item) => item.id === recentPin.id))).toBe(false);
    });
  });
});
