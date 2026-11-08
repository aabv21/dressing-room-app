import { translate, type MessageKey } from '../../i18n';
import type { Garment } from '../garmentRepository';
import { isStalePending, reviewQueue, slotCounts, toGridItems } from '../closetSelectors';
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
