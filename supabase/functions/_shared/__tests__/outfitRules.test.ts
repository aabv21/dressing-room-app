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

  test('accepts a cold outfit without outerwear when outerwearAvailable is false (P4-R7)', () => {
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

  test('sums across every piece', () => {
    const outfit = [
      garment({ last_worn_at: null, colors: ['red'] }),
      garment({ category: 'jeans', last_worn_at: '2026-11-06T00:00:00Z', colors: ['navy'] }),
    ];
    expect(preScore(outfit, TODAY)).toBe(30 + 2 + 5);
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

  test('includes a recently-worn item when it is the only shoes', () => {
    const recentShoes = garment({ category: 'sneakers', colors: ['white'], last_worn_at: '2026-11-06T00:00:00Z' });
    const closet = [garment({ category: 't_shirt', colors: ['white'] }), garment({ category: 'jeans', colors: ['navy'] }), recentShoes];
    const result = generateCandidates(closet, MILD_CTX, 'seed');
    expect(result.length).toBeGreaterThan(0);
    const usedRecent = result.some((outfit) => outfit.some((item) => item.id === recentShoes.id));
    expect(usedRecent).toBe(true);
  });

  test('a cold day with no available outerwear in the closet still returns candidates, none with outerwear (P4-R7)', () => {
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

  test('a rainy, non-hot day with no available outerwear still returns candidates (P4-R7)', () => {
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
});
