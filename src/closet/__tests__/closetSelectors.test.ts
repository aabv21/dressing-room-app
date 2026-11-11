import { translate, type MessageKey } from '../../i18n';
import type { Garment } from '../garmentRepository';
import {
  categoryCounts,
  fieldsToAsk,
  isLivePending,
  isStalePending,
  reviewQueue,
  slotCounts,
  toGridItems,
} from '../closetSelectors';
import { garment } from '../../test/garmentFixture';

const NOW = Date.parse('2026-11-08T12:00:00.000Z');
const MINUTE = 60 * 1000;

function createdAgo(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

const t = (key: MessageKey, params?: Readonly<Record<string, string | number>>): string => translate('en', key, params);

describe('isStalePending', () => {
  test('a pending garment is stale 10 min + 1 ms after created_at', () => {
    expect(isStalePending(garment({ created_at: createdAgo(10 * MINUTE + 1) }), NOW)).toBe(true);
  });

  test('a pending garment is not stale at 9 min (nor at exactly 10 min)', () => {
    expect(isStalePending(garment({ created_at: createdAgo(9 * MINUTE) }), NOW)).toBe(false);
    expect(isStalePending(garment({ created_at: createdAgo(10 * MINUTE) }), NOW)).toBe(false);
  });

  test('a finished extraction is never stale', () => {
    const old = createdAgo(60 * MINUTE);
    expect(isStalePending(garment({ created_at: old, extraction_status: 'done' }), NOW)).toBe(false);
    expect(isStalePending(garment({ created_at: old, extraction_status: 'failed' }), NOW)).toBe(false);
  });
});

describe('isLivePending', () => {
  test('a fresh pending garment is live', () => {
    expect(isLivePending(garment({ created_at: createdAgo(2 * MINUTE) }), NOW)).toBe(true);
  });

  test('a stale or finished extraction is not live', () => {
    expect(isLivePending(garment({ created_at: createdAgo(15 * MINUTE) }), NOW)).toBe(false);
    expect(isLivePending(garment({ created_at: createdAgo(2 * MINUTE), extraction_status: 'done' }), NOW)).toBe(false);
  });

  test('a fresh pending garment the user already reviewed is not live: the server never writes over a review', () => {
    const reviewed = garment({ created_at: createdAgo(2 * MINUTE), reviewed_at: createdAgo(1 * MINUTE) });
    expect(isLivePending(reviewed, NOW)).toBe(false);
  });
});

describe('reviewQueue', () => {
  test('excludes reviewed and fresh-pending garments and orders the rest oldest first', () => {
    const garments: Garment[] = [
      garment({ id: 'done-new', extraction_status: 'done', created_at: createdAgo(1 * MINUTE) }),
      garment({ id: 'reviewed', extraction_status: 'done', created_at: createdAgo(30 * MINUTE), reviewed_at: createdAgo(20 * MINUTE) }),
      garment({ id: 'fresh-pending', extraction_status: 'pending', created_at: createdAgo(2 * MINUTE) }),
      garment({ id: 'stale-pending', extraction_status: 'pending', created_at: createdAgo(15 * MINUTE) }),
      garment({ id: 'failed-old', extraction_status: 'failed', created_at: createdAgo(40 * MINUTE) }),
      garment({ id: 'over-quota', extraction_status: 'over_quota', created_at: createdAgo(5 * MINUTE) }),
    ];

    expect(reviewQueue(garments, NOW).map((g) => g.id)).toEqual(['failed-old', 'stale-pending', 'over-quota', 'done-new']);
  });

  test('does not reorder its input', () => {
    const garments = [
      garment({ id: 'b', extraction_status: 'done', created_at: createdAgo(1 * MINUTE) }),
      garment({ id: 'a', extraction_status: 'done', created_at: createdAgo(2 * MINUTE) }),
    ];
    reviewQueue(garments, NOW);
    expect(garments.map((g) => g.id)).toEqual(['b', 'a']);
  });
});

describe('fieldsToAsk', () => {
  const filled = {
    category: 'jeans',
    colors: ['navy'],
    pattern: 'solid',
    material: 'denim',
    formality: 2,
    seasons: ['spring', 'autumn'],
    warmth: 2,
    fit: 'regular',
    occasions: ['home'],
  } as const satisfies Partial<Garment>;

  test('a done garment with every value set asks only its uncertain fields', () => {
    const g = garment({ ...filled, colors: [...filled.colors], seasons: [...filled.seasons], occasions: [...filled.occasions], extraction_status: 'done', uncertain_fields: ['formality'] });
    expect(fieldsToAsk(g, NOW)).toEqual(['formality']);
  });

  test('a done garment also asks the empty basics, in field order', () => {
    const g = garment({ extraction_status: 'done', category: 'jeans', uncertain_fields: ['fit'] });
    expect(fieldsToAsk(g, NOW)).toEqual(['colors', 'formality', 'seasons', 'fit']);
  });

  test('a failed garment always asks category, colors, formality and seasons', () => {
    const g = garment({ ...filled, colors: [...filled.colors], seasons: [...filled.seasons], occasions: [...filled.occasions], extraction_status: 'failed' });
    expect(fieldsToAsk(g, NOW)).toEqual(['category', 'colors', 'formality', 'seasons']);
  });

  test('an over-quota garment (the AI never read it) asks the same four, plus its uncertain ones', () => {
    const g = garment({ ...filled, colors: [...filled.colors], seasons: [...filled.seasons], occasions: [...filled.occasions], extraction_status: 'over_quota', uncertain_fields: ['fit'] });
    expect(fieldsToAsk(g, NOW)).toEqual(['category', 'colors', 'formality', 'seasons', 'fit']);
  });

  test('a stale pending garment asks the same four', () => {
    const g = garment({ extraction_status: 'pending', created_at: createdAgo(11 * MINUTE) });
    expect(fieldsToAsk(g, NOW)).toEqual(['category', 'colors', 'formality', 'seasons']);
  });
});

describe('slotCounts', () => {
  test('a dress and two jeans give one one-piece and two bottoms', () => {
    const garments = [
      garment({ id: '1', category: 'dress' }),
      garment({ id: '2', category: 'jeans' }),
      garment({ id: '3', category: 'jeans' }),
    ];
    expect(slotCounts(garments)).toEqual({ one_piece: 1, bottom: 2 });
  });

  test('garments without a category are not counted', () => {
    expect(slotCounts([garment({ id: '1', category: null }), garment({ id: '2', category: 'hat' })])).toEqual({ headwear: 1 });
  });
});

describe('toGridItems', () => {
  const garments = [
    garment({ id: 'top', category: 't_shirt', wear_count: 4 }),
    garment({ id: 'jeans', category: 'jeans', photo_version: 3, status: 'laundry' }),
    garment({ id: 'skirt', category: 'skirt' }),
    garment({ id: 'new', category: null }),
  ];
  const thumbUrls = new Map([
    ['top', 'https://signed/top'],
    ['jeans', 'https://signed/jeans'],
  ]);

  test('filter "bottom" keeps only bottoms, in input order', () => {
    expect(toGridItems(garments, thumbUrls, 'bottom', t).map((item) => item.id)).toEqual(['jeans', 'skirt']);
  });

  test('toGridItems keeps only the chosen category', () => {
    expect(toGridItems(garments, thumbUrls, 'bottom', t, undefined, 'skirt').map((item) => item.id)).toEqual(['skirt']);
    expect(toGridItems(garments, thumbUrls, 'all', t, undefined, 't_shirt').map((item) => item.id)).toEqual(['top']);
  });

  test('filter "all" keeps every garment, including uncategorized ones', () => {
    expect(toGridItems(garments, thumbUrls, 'all', t).map((item) => item.id)).toEqual(['top', 'jeans', 'skirt', 'new']);
  });

  test('maps the signed URL, cache key, label, wear count and status badge', () => {
    const items = toGridItems(garments, thumbUrls, 'all', t);

    expect(items[0]).toEqual({
      id: 'top',
      thumbUri: 'https://signed/top',
      cacheKey: 'top:thumb:1',
      wearCount: 4,
      label: 'T-shirt',
    });
    expect(items[1]).toMatchObject({ cacheKey: 'jeans:thumb:3', label: 'Jeans', badge: 'In the laundry' });
  });

  test('a missing signed URL is an empty thumbUri, and no category reads as unnamed', () => {
    const item = toGridItems(garments, thumbUrls, 'all', t)[3];
    expect(item).toMatchObject({ thumbUri: '', label: 'New garment' });
    expect(item).not.toHaveProperty('badge');
  });
});

describe('donated garments', () => {
  const donated = garment({ id: 'gone', category: 'jeans', colors: ['blue'], status: 'donated', extraction_status: 'done' });
  const kept = garment({ id: 'kept', category: 'jeans', colors: ['black'], extraction_status: 'done' });

  test('are left out of the grid', () => {
    expect(toGridItems([donated, kept], new Map(), 'all', t).map((item) => item.id)).toEqual(['kept']);
  });

  test('are left out of the slot counts', () => {
    expect(slotCounts([donated, kept])).toEqual({ bottom: 1 });
  });

  test('never wait for review', () => {
    expect(reviewQueue([donated, kept], NOW).map((g) => g.id)).toEqual(['kept']);
  });
});

describe('toGridItems color filter', () => {
  const navyBlack = garment({ id: 'a', category: 'blouse', colors: ['navy', 'black'] });
  const white = garment({ id: 'b', category: 'jeans', colors: ['white'] });
  const fourth = garment({ id: 'c', category: 'skirt', colors: ['red', 'green', 'blue', 'black'] });

  test('keeps garments with any of the colors among their first three', () => {
    const items = toGridItems([navyBlack, white, fourth], new Map(), 'all', t, new Set(['black']));
    expect(items.map((item) => item.id)).toEqual(['a']);
    const red = toGridItems([navyBlack, white, fourth], new Map(), 'all', t, new Set(['red']));
    expect(red.map((item) => item.id)).toEqual(['c']);
  });

  test('combines with the slot filter', () => {
    const items = toGridItems([navyBlack, white, fourth], new Map(), 'bottom', t, new Set(['white', 'black']));
    expect(items.map((item) => item.id)).toEqual(['b']);
  });
});

test('categoryCounts counts active garments in the slot', () => {
  const garments = [
    garment({ id: 'a', category: 'jeans' }),
    garment({ id: 'b', category: 'jeans' }),
    garment({ id: 'c', category: 'skirt' }),
    garment({ id: 'd', category: 't_shirt' }),
    garment({ id: 'e', category: 'skirt', status: 'donated' }),
    garment({ id: 'f', category: null }),
  ];

  expect(categoryCounts(garments, 'bottom')).toEqual(new Map([['jeans', 2], ['skirt', 1]]));
  expect(categoryCounts(garments, 'all')).toEqual(new Map([['jeans', 2], ['skirt', 1], ['t_shirt', 1]]));
});
