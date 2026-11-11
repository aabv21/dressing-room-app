import { render, screen } from '@testing-library/react-native';

import { ShotStrip } from '../ShotStrip';

test('ShotStrip tiles are hidden from screen readers: the camera announces the shot count instead', async () => {
  await render(<ShotStrip uris={['file:///a.jpg', 'file:///b.jpg']} />);

  const strip = screen.getByTestId('shot-strip', { includeHiddenElements: true });
  expect(strip).toHaveProp('accessibilityElementsHidden', true);
  expect(strip).toHaveProp('importantForAccessibility', 'no-hide-descendants');
});
