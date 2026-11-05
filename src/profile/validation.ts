import type { MessageKey } from '../i18n';
import type { ProfilePatch } from './profileRepository';

/** Same bounds as the `profiles` CHECK constraints (global constraints → numeric ranges). */
export const HEIGHT_RANGE = { min: 120, max: 230 } as const;
export const MEASUREMENT_RANGE = { min: 40, max: 200 } as const;
export const SIZE_MAX_LENGTH = 10;

export type BodyInput = {
  heightCm: number | null;
  chestCm: string;
  waistCm: string;
  hipsCm: string;
  topSize: string;
  bottomSize: string;
  shoeSize: string;
};

export type BodyField = 'heightCm' | 'chestCm' | 'waistCm' | 'hipsCm' | 'topSize' | 'bottomSize' | 'shoeSize';

/** A translated message key plus the values its template interpolates (e.g. `{min}`/`{max}`). */
export type FieldError = { key: MessageKey; params: Readonly<Record<string, number>> };

export type BodyValidation =
  | { ok: true; patch: ProfilePatch }
  | { ok: false; errors: Partial<Record<BodyField, FieldError>> };

const WHOLE_NUMBER = /^\d+$/;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: FieldError };

function rangeError(range: { min: number; max: number }): FieldError {
  return { key: 'profile.validation.range', params: { min: range.min, max: range.max } };
}

function parseMeasurement(raw: string): Parsed<number | null> {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: true, value: null };
  }
  const value = WHOLE_NUMBER.test(trimmed) ? Number(trimmed) : Number.NaN;
  if (Number.isNaN(value) || value < MEASUREMENT_RANGE.min || value > MEASUREMENT_RANGE.max) {
    return { ok: false, error: rangeError(MEASUREMENT_RANGE) };
  }
  return { ok: true, value };
}

function parseSize(raw: string): Parsed<string | null> {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: true, value: null };
  }
  if (trimmed.length > SIZE_MAX_LENGTH) {
    return { ok: false, error: { key: 'profile.validation.sizeLength', params: { max: SIZE_MAX_LENGTH } } };
  }
  return { ok: true, value: trimmed };
}

function parseHeight(heightCm: number | null): Parsed<number | null> {
  if (heightCm === null) {
    return { ok: true, value: null };
  }
  if (!Number.isInteger(heightCm) || heightCm < HEIGHT_RANGE.min || heightCm > HEIGHT_RANGE.max) {
    return { ok: false, error: rangeError(HEIGHT_RANGE) };
  }
  return { ok: true, value: heightCm };
}

/**
 * Validates the Body step's height, measurements and sizes. Empty (or whitespace-only) text means
 * "not provided" and becomes `null` in the patch, so clearing a field clears the saved value.
 */
export function validateBody(input: BodyInput): BodyValidation {
  const parsed = {
    heightCm: parseHeight(input.heightCm),
    chestCm: parseMeasurement(input.chestCm),
    waistCm: parseMeasurement(input.waistCm),
    hipsCm: parseMeasurement(input.hipsCm),
    topSize: parseSize(input.topSize),
    bottomSize: parseSize(input.bottomSize),
    shoeSize: parseSize(input.shoeSize),
  };

  if (
    !parsed.heightCm.ok ||
    !parsed.chestCm.ok ||
    !parsed.waistCm.ok ||
    !parsed.hipsCm.ok ||
    !parsed.topSize.ok ||
    !parsed.bottomSize.ok ||
    !parsed.shoeSize.ok
  ) {
    return {
      ok: false,
      errors: {
        ...(parsed.heightCm.ok ? {} : { heightCm: parsed.heightCm.error }),
        ...(parsed.chestCm.ok ? {} : { chestCm: parsed.chestCm.error }),
        ...(parsed.waistCm.ok ? {} : { waistCm: parsed.waistCm.error }),
        ...(parsed.hipsCm.ok ? {} : { hipsCm: parsed.hipsCm.error }),
        ...(parsed.topSize.ok ? {} : { topSize: parsed.topSize.error }),
        ...(parsed.bottomSize.ok ? {} : { bottomSize: parsed.bottomSize.error }),
        ...(parsed.shoeSize.ok ? {} : { shoeSize: parsed.shoeSize.error }),
      },
    };
  }

  return {
    ok: true,
    patch: {
      height_cm: parsed.heightCm.value,
      chest_cm: parsed.chestCm.value,
      waist_cm: parsed.waistCm.value,
      hips_cm: parsed.hipsCm.value,
      top_size: parsed.topSize.value,
      bottom_size: parsed.bottomSize.value,
      shoe_size: parsed.shoeSize.value,
    },
  };
}
