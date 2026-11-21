import { act, render, screen } from '@testing-library/react-native';

import { COUNT_UP_MS, ScoreRing } from '../ScoreRing';

// Reduce Motion on (the final state at once) except in the count-up test.
const mockMotion = { reduced: true };
jest.mock('react-native-reanimated', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock()'s factory can only reference globals (incl. `require`), not a module-scoped import
  ...(require('../../test/reanimatedMock') as Record<string, unknown>),
  useReducedMotion: () => mockMotion.reduced,
}));

const mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

afterEach(() => {
  mockWindow.fontScale = 1;
  mockMotion.reduced = true;
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

test('the number counts up to the score, while the value read out is the score from the start', async () => {
  jest.useFakeTimers();
  mockMotion.reduced = false;
  try {
    await render(<ScoreRing score={78} caption="Looks good" />);
    expect(screen.getByText('0%', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByRole('progressbar')).toHaveProp('accessibilityValue', { min: 0, max: 100, now: 78 });

    await act(async () => {
      jest.advanceTimersByTime(COUNT_UP_MS / 2);
      await Promise.resolve();
    });
    const halfway = screen.getByText(/^\d+%$/, { includeHiddenElements: true }).props.children as string;
    expect(parseInt(halfway, 10)).toBeGreaterThan(0);
    expect(parseInt(halfway, 10)).toBeLessThan(78);

    await act(async () => {
      jest.advanceTimersByTime(COUNT_UP_MS);
      await Promise.resolve();
    });
    expect(screen.getByText('78%', { includeHiddenElements: true })).toBeOnTheScreen();
  } finally {
    jest.useRealTimers();
  }
});
