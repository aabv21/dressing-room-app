import { validateBody } from '../validation';
import type { BodyInput } from '../validation';

function input(overrides: Partial<BodyInput> = {}): BodyInput {
  return {
    heightCm: 165,
    chestCm: '',
    waistCm: '',
    hipsCm: '',
    topSize: '',
    bottomSize: '',
    shoeSize: '',
    ...overrides,
  };
}

test.each([119, 231])('rejects height %i with a range error', (heightCm) => {
  const result = validateBody(input({ heightCm }));
  expect(result).toEqual({
    ok: false,
    errors: { heightCm: { key: 'profile.validation.range', params: { min: 120, max: 230 } } },
  });
});

test.each([120, 230])('accepts height %i', (heightCm) => {
  const result = validateBody(input({ heightCm }));
  expect(result.ok && result.patch.height_cm).toBe(heightCm);
});

test('a null height stays null', () => {
  const result = validateBody(input({ heightCm: null }));
  expect(result.ok && result.patch.height_cm).toBeNull();
});

test('waist "abc" gives a range error with min and max', () => {
  const result = validateBody(input({ waistCm: 'abc' }));
  expect(result).toEqual({
    ok: false,
    errors: { waistCm: { key: 'profile.validation.range', params: { min: 40, max: 200 } } },
  });
});

test.each(['39', '201', '80.5', '-50', '1e2'])('chest %p is out of range or not a whole number', (chestCm) => {
  const result = validateBody(input({ chestCm }));
  expect(result.ok).toBe(false);
  expect(!result.ok && result.errors.chestCm?.key).toBe('profile.validation.range');
});

test('valid measurements are parsed and trimmed', () => {
  const result = validateBody(input({ chestCm: ' 90 ', waistCm: '70', hipsCm: '200' }));
  expect(result).toEqual({
    ok: true,
    patch: {
      height_cm: 165,
      chest_cm: 90,
      waist_cm: 70,
      hips_cm: 200,
      top_size: null,
      bottom_size: null,
      shoe_size: null,
    },
  });
});

test('empty strings (and whitespace) become null fields in the patch', () => {
  const result = validateBody(
    input({ chestCm: '', waistCm: '   ', hipsCm: '', topSize: '', bottomSize: '  ', shoeSize: '' }),
  );
  expect(result).toEqual({
    ok: true,
    patch: {
      height_cm: 165,
      chest_cm: null,
      waist_cm: null,
      hips_cm: null,
      top_size: null,
      bottom_size: null,
      shoe_size: null,
    },
  });
});

test('a top size of 11 characters is rejected; "  M " trims to "M"', () => {
  const tooLong = validateBody(input({ topSize: 'ABCDEFGHIJK' }));
  expect(tooLong).toEqual({
    ok: false,
    errors: { topSize: { key: 'profile.validation.sizeLength', params: { max: 10 } } },
  });

  const trimmed = validateBody(input({ topSize: '  M ', bottomSize: '32', shoeSize: '38' }));
  expect(trimmed.ok && trimmed.patch.top_size).toBe('M');
  expect(trimmed.ok && trimmed.patch.bottom_size).toBe('32');
  expect(trimmed.ok && trimmed.patch.shoe_size).toBe('38');
});

test('reports every invalid field at once', () => {
  const result = validateBody(input({ chestCm: 'x', hipsCm: '999', shoeSize: '12345678901' }));
  expect(result.ok).toBe(false);
  expect(!result.ok && Object.keys(result.errors).sort()).toEqual(['chestCm', 'hipsCm', 'shoeSize']);
});
