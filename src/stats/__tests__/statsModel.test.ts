import type { Garment } from '../../closet/garmentRepository';
import {
  activeGarments,
  colorShares,
  diaryByDay,
  kpis,
  mostWorn,
  slotBalance,
  unusedSixMonths,
} from '../statsModel';
import type { WearWithItems } from '../wearsRepository';

let nextId = 1;

function garment(overrides: Partial<Garment> = {}): Garment {
  const id = overrides.id ?? `g-${String(nextId)}`;
  nextId += 1;
  return {
    id,
    user_id: 'u-1',
    category: 't_shirt',
    colors: ['black'],
    pattern: null,
    material: null,
    formality: null,
    seasons: [],
    warmth: null,
    fit: null,
    occasions: [],
    status: 'available',
    extraction_status: 'done',
    uncertain_fields: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    reviewed_at: '2026-01-01T00:00:00Z',
    last_worn_at: null,
    pinned_on: null,
    photo_version: 1,
    wear_count: 0,
    ...overrides,
  };
}

function wear(overrides: Partial<WearWithItems> = {}): WearWithItems {
  return { id: `w-${String(nextId++)}`, wornOn: '2026-11-09', occasion: null, score: null, garmentIds: [], ...overrides };
}

beforeEach(() => {
  nextId = 1;
});

describe('activeGarments', () => {
  test('excludes donated garments', () => {
    const g1 = garment({ status: 'available' });
    const g2 = garment({ status: 'donated' });
    const g3 = garment({ status: 'laundry' });
    expect(activeGarments([g1, g2, g3])).toEqual([g1, g3]);
  });
});

describe('kpis', () => {
  test('an empty history gives 0 / 0 / null / 0', () => {
    expect(kpis([], [], 'week', '2026-11-09')).toEqual({ wornPct: 0, outfits: 0, avgScore: null, streak: 0 });
  });

  test('3 of 10 garments worn gives 30%', () => {
    const garments = Array.from({ length: 10 }, () => garment());
    const wears = garments.slice(0, 3).map((g) => wear({ wornOn: '2026-11-09', garmentIds: [g.id] }));
    expect(kpis(garments, wears, 'week', '2026-11-09').wornPct).toBe(30);
  });

  test('the score mean ignores nulls', () => {
    const wears = [
      wear({ wornOn: '2026-11-09', score: 80 }),
      wear({ wornOn: '2026-11-08', score: null }),
      wear({ wornOn: '2026-11-07', score: 90 }),
    ];
    expect(kpis([], wears, 'week', '2026-11-09').avgScore).toBe(85);
  });

  test('a streak with no wear today but yesterday counts from yesterday, and a gap breaks it', () => {
    const wears = [
      wear({ wornOn: '2026-11-08' }),
      wear({ wornOn: '2026-11-07' }),
      wear({ wornOn: '2026-11-06' }),
      // gap at 2026-11-05
      wear({ wornOn: '2026-11-04' }),
    ];
    expect(kpis([], wears, 'week', '2026-11-09').streak).toBe(3);
  });

  test('a streak looks back past the period start', () => {
    const wears = [
      wear({ wornOn: '2026-11-09' }),
      wear({ wornOn: '2026-10-25' }),
      wear({ wornOn: '2026-10-24' }),
    ];
    // Week period only covers 2026-11-03..09, but the streak must still see the Oct wears
    // feeding into today's single-day streak (no gap between them and today breaks it at 1,
    // since 2026-11-08 has no wear).
    expect(kpis([], wears, 'week', '2026-11-09').streak).toBe(1);
  });

  test('donated garments are excluded from the denominator but their wears still count toward outfits', () => {
    const available = garment({ status: 'available' });
    const donated = garment({ status: 'donated' });
    const wears = [wear({ wornOn: '2026-11-09', garmentIds: [donated.id] })];
    const result = kpis([available, donated], wears, 'week', '2026-11-09');
    expect(result.outfits).toBe(1);
    expect(result.wornPct).toBe(0); // the only active garment (`available`) was never worn.
  });

  test('scopes wornPct/outfits/avgScore to the period but the streak to full history', () => {
    const wears = [
      wear({ wornOn: '2026-11-09', score: 100 }),
      wear({ wornOn: '2026-10-01', score: 0 }), // outside the week period
    ];
    const result = kpis([], wears, 'week', '2026-11-09');
    expect(result.outfits).toBe(1);
    expect(result.avgScore).toBe(100);
  });
});

describe('mostWorn', () => {
  test('the top 5 by period count, ties broken by name, descending', () => {
    const jeans = garment({ category: 'jeans' });
    const shirt = garment({ category: 'shirt' });
    const tShirt = garment({ category: 't_shirt' });
    const jacket = garment({ category: 'jacket' }); // alphabetically last among the 1-count ties; excluded by limit
    const boots = garment({ category: 'boots' });
    const belt = garment({ category: 'belt' });

    const wears = [
      ...Array.from({ length: 3 }, () => wear({ garmentIds: [jeans.id] })),
      ...Array.from({ length: 2 }, () => wear({ garmentIds: [shirt.id] })),
      ...Array.from({ length: 2 }, () => wear({ garmentIds: [tShirt.id] })), // ties with shirt
      wear({ garmentIds: [jacket.id] }),
      wear({ garmentIds: [boots.id] }),
      wear({ garmentIds: [belt.id] }),
    ];

    const result = mostWorn([jeans, shirt, tShirt, jacket, boots, belt], wears);

    expect(result).toHaveLength(5);
    expect(result[0]).toEqual({ garment: jeans, count: 3 });
    // shirt ('shirt') sorts before t_shirt ('t_shirt') alphabetically on a tie.
    expect(result[1]).toEqual({ garment: shirt, count: 2 });
    expect(result[2]).toEqual({ garment: tShirt, count: 2 });
    // belt < boots < jacket alphabetically, so jacket is the one count-1 garment the limit drops.
    expect(result.map((r) => r.garment.id)).not.toContain(jacket.id);
    expect(result.map((r) => r.garment.id)).toEqual([jeans.id, shirt.id, tShirt.id, belt.id, boots.id]);
  });

  test('excludes donated garments even if worn in the period', () => {
    const donated = garment({ status: 'donated', category: 'jeans' });
    const wears = [wear({ garmentIds: [donated.id] })];
    expect(mostWorn([donated], wears)).toEqual([]);
  });

  test('empty wears gives an empty list', () => {
    expect(mostWorn([garment()], [])).toEqual([]);
  });
});

describe('colorShares', () => {
  test('rounding sums to 100', () => {
    const garments = [
      garment({ colors: ['black'] }),
      garment({ colors: ['black'] }),
      garment({ colors: ['white'] }),
      garment({ colors: ['navy'] }),
    ];
    const shares = colorShares(garments);
    expect(shares.reduce((sum, s) => sum + s.pct, 0)).toBe(100);
  });

  test('an "other" bucket appears after 5 colors', () => {
    const colors: Garment['colors'][number][] = ['black', 'white', 'navy', 'red', 'green', 'gold', 'silver'];
    const garments = colors.map((color) => garment({ colors: [color] }));
    const shares = colorShares(garments);
    expect(shares).toHaveLength(6);
    expect(shares.some((s) => s.color === 'other')).toBe(true);
    expect(shares.reduce((sum, s) => sum + s.pct, 0)).toBe(100);
  });

  test('empty closet gives []', () => {
    expect(colorShares([])).toEqual([]);
  });

  test('excludes donated garments and counts at most 3 colors per garment', () => {
    const donated = garment({ status: 'donated', colors: ['red'] });
    const multi = garment({ colors: ['black', 'white', 'navy', 'red'] }); // red (4th) dropped
    const shares = colorShares([donated, multi]);
    expect(shares.find((s) => s.color === 'red')).toBeUndefined();
    expect(shares).toHaveLength(3);
  });
});

describe('slotBalance', () => {
  test('3 tops, 2 bottoms, 1 dress and 2 shoes gives possible = 14', () => {
    const garments = [
      ...Array.from({ length: 3 }, () => garment({ category: 't_shirt' })),
      ...Array.from({ length: 2 }, () => garment({ category: 'jeans' })),
      garment({ category: 'dress' }),
      ...Array.from({ length: 2 }, () => garment({ category: 'sneakers' })),
    ];
    const balance = slotBalance(garments);
    expect(balance).toMatchObject({ top: 4, bottom: 2, shoes: 2, outerwear: 0, possible: 14 });
  });

  test('the insight picks the slot with the biggest +1 gain', () => {
    // top=3, bottom=2, onePiece=0, shoes=1 → possible = 6*1 = 6.
    // +1 top -> (4*2)*1=8 (+2); +1 bottom -> (3*3)*1=9 (+3); +1 shoes -> (3*2)*2=12 (+6).
    const garments = [
      ...Array.from({ length: 3 }, () => garment({ category: 't_shirt' })),
      ...Array.from({ length: 2 }, () => garment({ category: 'jeans' })),
      garment({ category: 'sneakers' }),
    ];
    const balance = slotBalance(garments);
    expect(balance.insight).toEqual({ slot: 'shoes', from: 6, to: 12 });
  });

  test('no insight when no +1 would add outfits (possible stays at 0)', () => {
    const garments = [garment({ category: 't_shirt' })]; // no bottoms/shoes: possible = 0, and +1 anywhere is still 0
    const balance = slotBalance(garments);
    expect(balance.possible).toBe(0);
    expect(balance.insight).toBeNull();
  });

  test('one-pieces are counted in top and outerwear is tracked separately', () => {
    const garments = [garment({ category: 'dress' }), garment({ category: 'jacket' })];
    const balance = slotBalance(garments);
    expect(balance.top).toBe(1);
    expect(balance.outerwear).toBe(1);
  });

  test('excludes donated garments', () => {
    const garments = [garment({ category: 't_shirt', status: 'donated' })];
    expect(slotBalance(garments).top).toBe(0);
  });
});

describe('unusedSixMonths', () => {
  const today = '2026-11-09';

  test('excludes a donated garment', () => {
    const g = garment({ status: 'donated', created_at: '2026-01-01T00:00:00Z', last_worn_at: null });
    expect(unusedSixMonths([g], today)).toEqual([]);
  });

  test('excludes a recently created garment even if never worn', () => {
    const g = garment({ created_at: '2026-11-01T00:00:00Z', last_worn_at: null });
    expect(unusedSixMonths([g], today)).toEqual([]);
  });

  test('excludes a garment worn recently even if created long ago', () => {
    const g = garment({ created_at: '2025-01-01T00:00:00Z', last_worn_at: '2026-11-01T00:00:00Z' });
    expect(unusedSixMonths([g], today)).toEqual([]);
  });

  test('includes an old, never-worn garment', () => {
    const g = garment({ created_at: '2025-01-01T00:00:00Z', last_worn_at: null });
    expect(unusedSixMonths([g], today)).toEqual([g]);
  });

  test('includes an old garment last worn more than 6 months ago', () => {
    const g = garment({ created_at: '2025-01-01T00:00:00Z', last_worn_at: '2026-01-01T00:00:00Z' });
    expect(unusedSixMonths([g], today)).toEqual([g]);
  });
});

describe('diaryByDay', () => {
  test('groups wears by local day', () => {
    const w1 = wear({ wornOn: '2026-11-09' });
    const w2 = wear({ wornOn: '2026-11-09' });
    const w3 = wear({ wornOn: '2026-11-08' });
    const byDay = diaryByDay([w1, w2, w3]);
    expect(byDay.get('2026-11-09')).toEqual([w1, w2]);
    expect(byDay.get('2026-11-08')).toEqual([w3]);
    expect(byDay.size).toBe(2);
  });

  test('empty history gives an empty map', () => {
    expect(diaryByDay([]).size).toBe(0);
  });
});
