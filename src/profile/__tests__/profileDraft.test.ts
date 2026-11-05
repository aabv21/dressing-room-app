import { changedFields, defaultHeightFor, draftFromProfile, draftToPatch, withClothingType } from '../profileDraft';
import type { ProfileDraft } from '../profileDraft';

function draft(overrides: Partial<ProfileDraft> = {}): ProfileDraft {
  return { ...draftFromProfile({}), ...overrides };
}

describe('draftFromProfile', () => {
  test('turns saved numbers and nulls into the editable text the fields show', () => {
    expect(
      draftFromProfile({
        clothing_type: 'feminine',
        body_type: 'pear',
        height_cm: 170,
        chest_cm: 88,
        waist_cm: null,
        top_size: 'M',
        styles: ['casual'],
        city_name: 'Bogotá',
        city_lat: 4.7,
        city_lon: -74,
      }),
    ).toEqual({
      clothingType: 'feminine',
      bodyType: 'pear',
      heightCm: 170,
      chestCm: '88',
      waistCm: '',
      hipsCm: '',
      topSize: 'M',
      bottomSize: '',
      shoeSize: '',
      ageGroup: null,
      styles: ['casual'],
      occasions: [],
      cityName: 'Bogotá',
      cityCoords: { lat: 4.7, lon: -74 },
    });
  });

  test('drops a saved body type that is not offered for the saved clothing type', () => {
    expect(draftFromProfile({ clothing_type: 'masculine', body_type: 'pear' }).bodyType).toBeNull();
    expect(draftFromProfile({ clothing_type: 'masculine', body_type: 'rectangle' }).bodyType).toBe('rectangle');
  });

  test('keeps coordinates only as a complete pair', () => {
    expect(draftFromProfile({ city_name: 'X', city_lat: 1, city_lon: null }).cityCoords).toBeNull();
  });
});

describe('withClothingType', () => {
  test('keeps a body type the new set still offers', () => {
    expect(withClothingType(draft({ clothingType: 'feminine', bodyType: 'rectangle' }), 'masculine')).toEqual({
      clothingType: 'masculine',
    });
  });

  test('clears a body type the new set does not offer', () => {
    expect(withClothingType(draft({ clothingType: 'feminine', bodyType: 'hourglass' }), 'masculine')).toEqual({
      clothingType: 'masculine',
      bodyType: null,
    });
  });
});

test('defaultHeightFor: 175 for masculine, 165 otherwise', () => {
  expect(defaultHeightFor('masculine')).toBe(175);
  expect(defaultHeightFor('feminine')).toBe(165);
  expect(defaultHeightFor('everything')).toBe(165);
  expect(defaultHeightFor(null)).toBe(165);
});

describe('draftToPatch', () => {
  test('maps every editable field to its column, trimming the city and nulling an empty one', () => {
    const result = draftToPatch(
      draft({
        clothingType: 'masculine',
        bodyType: 'oval',
        heightCm: 180,
        waistCm: '90',
        shoeSize: ' 42 ',
        ageGroup: '25_34',
        styles: ['urban'],
        occasions: ['office'],
        cityName: '  ',
        cityCoords: { lat: 1, lon: 2 },
      }),
    );

    expect(result).toEqual({
      ok: true,
      patch: {
        clothing_type: 'masculine',
        body_type: 'oval',
        height_cm: 180,
        chest_cm: null,
        waist_cm: 90,
        hips_cm: null,
        top_size: null,
        bottom_size: null,
        shoe_size: '42',
        age_group: '25_34',
        styles: ['urban'],
        occasions: ['office'],
        city_name: null,
        city_lat: null,
        city_lon: null,
      },
    });
  });

  test('reports the validation errors instead of a patch', () => {
    const result = draftToPatch(draft({ waistCm: 'abc' }));
    expect(result).toEqual({
      ok: false,
      errors: { waistCm: { key: 'profile.validation.range', params: { min: 40, max: 200 } } },
    });
  });
});

describe('changedFields', () => {
  test('keeps only the columns whose value differs, comparing arrays by content', () => {
    expect(
      changedFields(
        { height_cm: 170, styles: ['casual', 'urban'], occasions: ['office'], top_size: 'M', body_type: null },
        { height_cm: 172, styles: ['casual', 'urban'], occasions: ['home'], top_size: 'M', body_type: null },
      ),
    ).toEqual({ height_cm: 172, occasions: ['home'] });
  });

  test('a column missing from the saved values counts as null', () => {
    expect(changedFields({}, { chest_cm: null, waist_cm: 80 })).toEqual({ waist_cm: 80 });
  });
});
