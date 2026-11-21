import { fireEvent, render, screen } from '@testing-library/react-native';

import { ShotStrip } from '../ShotStrip';

test('ShotStrip tiles are hidden from screen readers: the camera announces the shot count instead', async () => {
  await render(<ShotStrip uris={['file:///a.jpg', 'file:///b.jpg']} />);

  const strip = screen.getByTestId('shot-strip', { includeHiddenElements: true });
  expect(strip).toHaveProp('accessibilityElementsHidden', true);
  expect(strip).toHaveProp('importantForAccessibility', 'no-hide-descendants');
});

test('with onRemoveLast, the newest shot is a reachable "Remove the last photo" button', async () => {
  const onRemoveLast = jest.fn();
  await render(<ShotStrip uris={['file:///a.jpg', 'file:///b.jpg']} onRemoveLast={onRemoveLast} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Remove the last photo' }));
  expect(onRemoveLast).toHaveBeenCalledTimes(1);
});

test('no shots, no remove button', async () => {
  await render(<ShotStrip uris={[]} onRemoveLast={jest.fn()} />);
  expect(screen.queryByRole('button', { name: 'Remove the last photo' })).not.toBeOnTheScreen();
});
