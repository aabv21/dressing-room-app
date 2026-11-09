import { render, screen } from '@testing-library/react-native';

import { ScoreRing } from '../ScoreRing';

test('the ring is one progressbar named with its score, the score as its value', async () => {
  await render(<ScoreRing score={78.4} caption="Looks good" />);
  const ring = screen.getByRole('progressbar');
  expect(ring).toHaveAccessibleName('Score: 78%');
  expect(ring).toHaveProp('accessibilityValue', { min: 0, max: 100, now: 78 });
  // The caption is its own text, read after the ring.
  expect(screen.getByText('Looks good')).toBeOnTheScreen();
});

test('the number and caption are capped for large text so they stay inside the ring', async () => {
  await render(<ScoreRing score={100} caption="Looks great" />);
  expect(screen.getByText('100%', { includeHiddenElements: true })).toHaveProp('maxFontSizeMultiplier', 1.2);
  expect(screen.getByText('Looks great')).toHaveProp('maxFontSizeMultiplier', 1.2);
});

test('a zero score draws only the track', async () => {
  await render(<ScoreRing score={0} caption="Doesn't work" />);
  expect(screen.queryByTestId('score-ring-arc', { includeHiddenElements: true })).toBeNull();
});
