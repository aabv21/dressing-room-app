import { fireEvent, render, screen } from '@testing-library/react-native';

import { SegmentTabs } from '../../closet/SegmentTabs';

const options = [
  { value: 'items', label: 'Items' },
  { value: 'stats', label: 'Stats' },
  { value: 'diary', label: 'Diary' },
] as const;

test('a named tablist whose selected tab exposes its state, capped for large text with the large content viewer', async () => {
  const onChange = jest.fn();
  await render(<SegmentTabs options={options} value="stats" onChange={onChange} accessibilityLabel="Closet sections" />);

  // A container role: RNTL's role queries only match accessibility elements, so it's found by label.
  expect(screen.getByLabelText('Closet sections')).toHaveProp('accessibilityRole', 'tablist');
  expect(screen.getByRole('tab', { name: 'Stats' })).toBeSelected();
  expect(screen.getByRole('tab', { name: 'Items' })).not.toBeSelected();
  for (const tab of screen.getAllByRole('tab')) {
    expect(tab).toHaveProp('accessibilityShowsLargeContentViewer', true);
    expect(tab).toHaveProp('accessibilityLargeContentTitle', tab.props.accessibilityLabel);
  }
  expect(screen.getByText('Diary')).toHaveProp('maxFontSizeMultiplier', 1.3);

  await fireEvent.press(screen.getByRole('tab', { name: 'Diary' }));
  expect(onChange).toHaveBeenCalledWith('diary');
});
