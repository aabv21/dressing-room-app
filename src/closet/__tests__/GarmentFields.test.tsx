import { fireEvent, render, screen } from '@testing-library/react-native';

import { garment } from '../../test/garmentFixture';
import { changedFields, ConfirmedRow, FieldEditor, fieldValuesOf, type FieldValues } from '../GarmentFields';

function valuesOf(overrides: Partial<FieldValues> = {}): FieldValues {
  const { category, colors, pattern, material, formality, seasons, warmth, fit, occasions } = garment(overrides);
  return { category, colors, pattern, material, formality, seasons, warmth, fit, occasions };
}

describe('FieldEditor', () => {
  test.each([
    ['Casual', 2],
    ['Formal', 4],
    ['Both', 3],
  ])('formality: %s stores %i', async (label, stored) => {
    const onChange = jest.fn();
    await render(<FieldEditor field="formality" values={valuesOf()} onChange={onChange} clothingType="everything" />);

    await fireEvent.press(screen.getByRole('radio', { name: label }));

    expect(onChange).toHaveBeenCalledWith(valuesOf({ formality: stored }));
  });

  test('formality: a stored 1 or 5 still shows as Casual or Formal', async () => {
    const { rerender } = await render(
      <FieldEditor field="formality" values={valuesOf({ formality: 1 })} onChange={jest.fn()} clothingType="everything" />,
    );
    expect(screen.getByRole('radio', { name: 'Casual' })).toBeChecked();

    await rerender(
      <FieldEditor field="formality" values={valuesOf({ formality: 5 })} onChange={jest.fn()} clothingType="everything" />,
    );
    expect(screen.getByRole('radio', { name: 'Formal' })).toBeChecked();
  });

  test('seasons: "All year" selects all four', async () => {
    const onChange = jest.fn();
    await render(
      <FieldEditor field="seasons" values={valuesOf({ seasons: ['summer'] })} onChange={onChange} clothingType="everything" />,
    );

    await fireEvent.press(screen.getByRole('checkbox', { name: 'All year' }));

    expect(onChange).toHaveBeenCalledWith(valuesOf({ seasons: ['spring', 'summer', 'autumn', 'winter'] }));
  });

  test('seasons: all four selected shows "All year" on, and tapping a season leaves the other three', async () => {
    const onChange = jest.fn();
    await render(
      <FieldEditor
        field="seasons"
        values={valuesOf({ seasons: ['spring', 'summer', 'autumn', 'winter'] })}
        onChange={onChange}
        clothingType="everything"
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'All year' })).toBeChecked();

    await fireEvent.press(screen.getByRole('checkbox', { name: 'Summer' }));

    expect(onChange).toHaveBeenCalledWith(valuesOf({ seasons: ['spring', 'autumn', 'winter'] }));
  });

  test('colors: a 4th color chip is disabled when 3 are selected', async () => {
    const onChange = jest.fn();
    await render(
      <FieldEditor
        field="colors"
        values={valuesOf({ colors: ['navy', 'white', 'red'] })}
        onChange={onChange}
        clothingType="everything"
      />,
    );

    const black = screen.getByRole('checkbox', { name: 'Black' });
    expect(black).toBeDisabled();
    await fireEvent.press(black);
    expect(onChange).not.toHaveBeenCalled();

    // A selected color can still be removed.
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Red' }));
    expect(onChange).toHaveBeenCalledWith(valuesOf({ colors: ['navy', 'white'] }));
  });

  test('category: a current jeans shows only bottoms', async () => {
    await render(
      <FieldEditor field="category" values={valuesOf({ category: 'jeans' })} onChange={jest.fn()} clothingType="everything" />,
    );

    expect(screen.getAllByRole('radio').map((chip) => chip.props.accessibilityLabel as string)).toEqual([
      'Pants',
      'Jeans',
      'Shorts',
      'Skirt',
      'Leggings',
    ]);
  });

  test('category: a doubted category is not narrowed, so a current jeans also offers tops (P3-R12)', async () => {
    await render(
      <FieldEditor
        field="category"
        values={valuesOf({ category: 'jeans' })}
        onChange={jest.fn()}
        clothingType="everything"
        narrowCategory={false}
      />,
    );

    expect(screen.getByRole('radio', { name: 'Jeans' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'T-shirt' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Pants' })).toBeOnTheScreen();
  });

  test('category: without one, every category for the clothing type is offered', async () => {
    await render(<FieldEditor field="category" values={valuesOf()} onChange={jest.fn()} clothingType="masculine" />);

    expect(screen.getByRole('radio', { name: 'T-shirt' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Tie' })).toBeOnTheScreen();
    expect(screen.queryByRole('radio', { name: 'Skirt' })).not.toBeOnTheScreen();
  });

  test('warmth: three levels stored as 1-3', async () => {
    const onChange = jest.fn();
    await render(<FieldEditor field="warmth" values={valuesOf()} onChange={onChange} clothingType="everything" />);

    await fireEvent.press(screen.getByRole('radio', { name: 'Warm' }));

    expect(onChange).toHaveBeenCalledWith(valuesOf({ warmth: 3 }));
  });

  test('pattern: single-select', async () => {
    const onChange = jest.fn();
    await render(
      <FieldEditor field="pattern" values={valuesOf({ pattern: 'solid' })} onChange={onChange} clothingType="everything" />,
    );

    await fireEvent.press(screen.getByRole('radio', { name: 'Striped' }));

    expect(onChange).toHaveBeenCalledWith(valuesOf({ pattern: 'striped' }));
  });
});

describe('ConfirmedRow', () => {
  test('shows the label, the value and a check, and taps through to edit', async () => {
    const onEdit = jest.fn();
    await render(<ConfirmedRow field="category" values={valuesOf({ category: 't_shirt' })} onEdit={onEdit} />);

    expect(screen.getByText('Category')).toBeOnTheScreen();
    expect(screen.getByText('T-shirt')).toBeOnTheScreen();
    expect(screen.getByText('✓')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Category · T-shirt' }));
    expect(onEdit).toHaveBeenCalled();
  });

  test('all four seasons read "All year"; several colors are listed', async () => {
    await render(
      <>
        <ConfirmedRow field="seasons" values={valuesOf({ seasons: ['spring', 'summer', 'autumn', 'winter'] })} onEdit={jest.fn()} />
        <ConfirmedRow field="colors" values={valuesOf({ colors: ['navy', 'light_blue'] })} onEdit={jest.fn()} />
      </>,
    );

    expect(screen.getByText('All year')).toBeOnTheScreen();
    expect(screen.getByText('Navy, Light blue')).toBeOnTheScreen();
  });
});

describe('FieldEditor disabled', () => {
  test('shows every choice but none can be tapped', async () => {
    const onChange = jest.fn();
    await render(
      <FieldEditor field="pattern" values={valuesOf({ pattern: 'solid' })} onChange={onChange} clothingType="everything" disabled />,
    );

    expect(screen.getByRole('radio', { name: 'Solid' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Striped' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('radio', { name: 'Striped' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('changedFields', () => {
  const stored = valuesOf({ category: 'jeans', colors: ['navy', 'white'], pattern: 'solid', seasons: ['spring'] });

  test('nothing changed gives an empty patch', () => {
    expect(changedFields(stored, { ...stored, colors: ['navy', 'white'] })).toEqual({});
  });

  test('only the changed fields, with their new values', () => {
    expect(changedFields(stored, { ...stored, pattern: 'striped', seasons: ['spring', 'summer'] })).toEqual({
      pattern: 'striped',
      seasons: ['spring', 'summer'],
    });
  });

  test('a cleared value and a reordered color list both count as changes', () => {
    // The first color is the dominant one, so the order matters.
    expect(changedFields(stored, { ...stored, category: null, colors: ['white', 'navy'] })).toEqual({
      category: null,
      colors: ['white', 'navy'],
    });
  });

  test('fieldValuesOf picks the nine attributes off a row', () => {
    expect(fieldValuesOf(garment({ pattern: 'floral', status: 'lent' }))).toEqual(valuesOf({ pattern: 'floral' }));
  });
});
