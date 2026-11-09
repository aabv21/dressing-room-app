// With Reduce Motion on, the charts render their final state and start no animation.
import { render, screen } from '@testing-library/react-native';

import { ScoreRing } from '../../../outfits/ScoreRing';
import { HorizontalBars } from '../HorizontalBars';

const mockTimings: unknown[] = [];
jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock()'s factory can only reference globals (incl. `require`), not a module-scoped import; see src/test/reanimatedMock.ts's module doc
  const base = require('../../../test/reanimatedMock') as Record<string, unknown>;
  return {
    __esModule: true,
    ...base,
    useReducedMotion: () => true,
    withTiming: (toValue: unknown) => {
      mockTimings.push(toValue);
      return toValue;
    },
  };
});

function widthOf(testID: string): string | undefined {
  const style = screen.getByTestId(testID).props.style as { width?: string }[] | { width?: string };
  const list = Array.isArray(style) ? style : [style];
  return list.find((entry) => entry.width !== undefined)?.width;
}

test('the bars render at their final widths without a timing animation', async () => {
  await render(
    <HorizontalBars
      rows={[
        { id: 'max', label: 'Max row', value: 30, valueLabel: '30' },
        { id: 'third', label: 'Third row', value: 10, valueLabel: '10' },
      ]}
    />,
  );
  expect(widthOf('bar-fill-max')).toBe('100%');
  expect(widthOf('bar-fill-third')).toBe(`${String((10 / 30) * 100)}%`);
  expect(mockTimings).toEqual([]);
});

test('the score ring draws its final arc at once', async () => {
  await render(<ScoreRing score={78} caption="Looks good" />);
  const circumference = 2 * Math.PI * ((112 - 10) / 2);
  expect(screen.getByTestId('score-ring-arc')).toHaveProp('strokeDashoffset', circumference * (1 - 0.78));
  expect(mockTimings).toEqual([]);
});
