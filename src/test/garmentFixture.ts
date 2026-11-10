import type { Garment } from '../closet/garmentRepository';

/** A garment row as `listGarments` returns it: a fresh, unreviewed, pending upload unless overridden. */
export function garment(overrides: Partial<Garment> = {}): Garment {
  return {
    id: 'garment-1',
    user_id: 'user-1',
    category: null,
    colors: [],
    pattern: null,
    material: null,
    formality: null,
    seasons: [],
    warmth: null,
    fit: null,
    occasions: [],
    status: 'available',
    extraction_status: 'pending',
    uncertain_fields: [],
    photo_version: 1,
    wear_count: 0,
    last_worn_at: null,
    pinned_on: null,
    reviewed_at: null,
    created_at: '2026-11-08T12:00:00.000Z',
    updated_at: '2026-11-08T12:00:00.000Z',
    ...overrides,
  };
}
