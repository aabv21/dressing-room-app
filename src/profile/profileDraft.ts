import type { Database } from '../lib/database.types';
import { silhouettesFor } from './bodyType';
import type { BodyType, ClothingType } from './bodyType';
import type { ProfilePatch } from './profileRepository';
import { validateBody } from './validation';
import type { BodyField, FieldError } from './validation';

export type AgeGroup = Database['public']['Enums']['age_group'];
export type Style = Database['public']['Enums']['style'];
export type Occasion = Database['public']['Enums']['occasion'];

/**
 * The editable form state behind `ProfileForm`'s sections, shared by onboarding and Profile.
 * Measurements and sizes stay raw text (what the user typed, e.g. `'abc'` or `'  M '`) until
 * `draftToPatch` validates them, so a failed save never rewrites the fields.
 */
export type ProfileDraft = {
  clothingType: ClothingType | null;
  bodyType: BodyType | null;
  /** `null` until a height is saved or the slider moves; the slider shows `defaultHeightFor`. */
  heightCm: number | null;
  chestCm: string;
  waistCm: string;
  hipsCm: string;
  topSize: string;
  bottomSize: string;
  shoeSize: string;
  ageGroup: AgeGroup | null;
  styles: Style[];
  occasions: Occasion[];
  cityName: string;
  /** Coordinates only travel with the name they were geocoded to; typing a city drops them. */
  cityCoords: { lat: number; lon: number } | null;
};

export type BodyErrors = Partial<Record<BodyField, FieldError>>;

/** Global constraints: the slider defaults to 175 cm for masculine, 165 cm otherwise. */
export function defaultHeightFor(clothing: ClothingType | null): number {
  return clothing === 'masculine' ? 175 : 165;
}

function toText(value: string | number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

export function draftFromProfile(profile: ProfilePatch): ProfileDraft {
  const clothingType = profile.clothing_type ?? null;
  const bodyType = profile.body_type ?? null;
  const lat = profile.city_lat ?? null;
  const lon = profile.city_lon ?? null;
  return {
    clothingType,
    // A body type outside the clothing type's silhouette set (possible only through older data)
    // would be invisible in the grid, so it is treated as unselected.
    bodyType: bodyType !== null && silhouettesFor(clothingType ?? 'everything').includes(bodyType) ? bodyType : null,
    heightCm: profile.height_cm ?? null,
    chestCm: toText(profile.chest_cm),
    waistCm: toText(profile.waist_cm),
    hipsCm: toText(profile.hips_cm),
    topSize: toText(profile.top_size),
    bottomSize: toText(profile.bottom_size),
    shoeSize: toText(profile.shoe_size),
    ageGroup: profile.age_group ?? null,
    styles: profile.styles ?? [],
    occasions: profile.occasions ?? [],
    cityName: profile.city_name ?? '',
    cityCoords: lat !== null && lon !== null ? { lat, lon } : null,
  };
}

/**
 * The change a new clothing type makes: a selected silhouette the new type doesn't offer is
 * cleared, so it is saved as null instead of lingering as a hidden, mismatched value.
 */
export function withClothingType(draft: ProfileDraft, clothingType: ClothingType): Partial<ProfileDraft> {
  if (draft.bodyType !== null && !silhouettesFor(clothingType).includes(draft.bodyType)) {
    return { clothingType, bodyType: null };
  }
  return { clothingType };
}

export type DraftValidation = { ok: true; patch: ProfilePatch } | { ok: false; errors: BodyErrors };

/** The Body section's columns: validated height, measurements and sizes, plus silhouette and age. */
export function bodyToPatch(draft: ProfileDraft): DraftValidation {
  const body = validateBody({
    heightCm: draft.heightCm,
    chestCm: draft.chestCm,
    waistCm: draft.waistCm,
    hipsCm: draft.hipsCm,
    topSize: draft.topSize,
    bottomSize: draft.bottomSize,
    shoeSize: draft.shoeSize,
  });
  if (!body.ok) {
    return body;
  }
  return { ok: true, patch: { body_type: draft.bodyType, ...body.patch, age_group: draft.ageGroup } };
}

/** The Style section's columns. The city is trimmed; an empty one clears the name and coordinates. */
export function styleToPatch(draft: ProfileDraft): ProfilePatch {
  const cityName = draft.cityName.trim();
  const coords = cityName === '' ? null : draft.cityCoords;
  return {
    styles: draft.styles,
    occasions: draft.occasions,
    city_name: cityName === '' ? null : cityName,
    city_lat: coords?.lat ?? null,
    city_lon: coords?.lon ?? null,
  };
}

/** Validates the draft and maps it to every editable column. */
export function draftToPatch(draft: ProfileDraft): DraftValidation {
  const body = bodyToPatch(draft);
  if (!body.ok) {
    return body;
  }
  return { ok: true, patch: { clothing_type: draft.clothingType, ...body.patch, ...styleToPatch(draft) } };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((entry, index) => entry === b.at(index));
  }
  return a === b;
}

/** The subset of `next` whose values differ from `saved` (a column absent from `saved` is null). */
export function changedFields(saved: ProfilePatch, next: ProfilePatch): ProfilePatch {
  const savedValues = new Map<string, unknown>(Object.entries(saved));
  const changed = Object.entries(next).filter(([key, value]) => !sameValue(savedValues.get(key) ?? null, value));
  return Object.fromEntries(changed);
}
