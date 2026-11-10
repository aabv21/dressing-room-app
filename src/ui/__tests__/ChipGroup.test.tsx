import { fireEvent, render, screen } from '@testing-library/react-native';

import { ChipGroup } from '../ChipGroup';

const options = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year', disabled: true },
] as const;

test('single select is a named radiogroup whose chips expose checked, selected and disabled', async () => {
  await render(
    <ChipGroup options={options} selected={['month']} onChange={jest.fn()} multiple={false} accessibilityLabel="Period" />,
  );
  // A container role: RNTL's role queries only match accessibility elements, so it's found by label.
  expect(screen.getByLabelText('Period')).toHaveProp('accessibilityRole', 'radiogroup');
  const month = screen.getByRole('radio', { name: 'Month' });
  expect(month).toBeChecked();
  expect(month).toBeSelected();
  const week = screen.getByRole('radio', { name: 'Week' });
  expect(week).not.toBeChecked();
  expect(week).not.toBeSelected();
  expect(screen.getByRole('radio', { name: 'Year' })).toBeDisabled();
});

test('multiple select chips are checkboxes that toggle', async () => {
  const onChange = jest.fn();
  await render(<ChipGroup options={options} selected={['week']} onChange={onChange} />);
  expect(screen.getByRole('checkbox', { name: 'Week' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Month' })).not.toBeChecked();
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Month' }));
  expect(onChange).toHaveBeenCalledWith(['week', 'month']);
});
