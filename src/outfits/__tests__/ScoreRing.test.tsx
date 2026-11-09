import { render, screen } from '@testing-library/react-native';

import { ScoreRing } from '../ScoreRing';

const mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

afterEach(() => {
  mockWindow.fontScale = 1;
});

test('the ring is one progressbar named "Score", its score read once through the value', async () => {
  await render(<ScoreRing score={78.4} caption="Looks good" />);
  const ring = screen.getByRole('progressbar');
  expect(ring).toHaveAccessibleName('Score');
  expect(ring).toHaveProp('accessibilityValue', { min: 0, max: 100, now: 78 });
  // The caption is its own text, read after the ring.
  expect(screen.getByText('Looks good')).toBeOnTheScreen();
});

test('the number and caption are capped for large text, and the ring grows with them so the caption clears the arc', async () => {
  await render(<ScoreRing score={100} caption="Looks great" />);
  expect(screen.getByTestId('score-ring')).toHaveStyle({ width: 112, height: 112 });

  mockWindow.fontScale = 3.1;
  await screen.rerender(<ScoreRing score={100} caption="Looks great" />);
  expect(screen.getByText('100%', { includeHiddenElements: true })).toHaveProp('maxFontSizeMultiplier', 1.2);
  expect(screen.getByText('Looks great')).toHaveProp('maxFontSizeMultiplier', 1.2);
  expect(screen.getByTestId('score-ring')).toHaveStyle({ width: 112 * 1.2, height: 112 * 1.2 });
});

test('a zero score draws only the track', async () => {
  await render(<ScoreRing score={0} caption="Doesn't work" />);
  expect(screen.queryByTestId('score-ring-arc', { includeHiddenElements: true })).toBeNull();
});
