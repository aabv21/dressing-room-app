import { fireEvent, render, screen } from '@testing-library/react-native';

import { HorizontalBars } from '../HorizontalBars';
import { KpiTile } from '../KpiTile';
import { ProportionBar } from '../ProportionBar';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return -- jest.mock()'s factory can only reference globals (incl. `require`), not a module-scoped import; see src/test/reanimatedMock.ts's module doc
jest.mock('react-native-reanimated', () => require('../../../test/reanimatedMock'));

// The device's text size (iOS Dynamic Type, Android font scale), as the charts read it.
const mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

afterEach(() => {
  mockWindow.fontScale = 1;
});

describe('HorizontalBars', () => {
  const rows = [
    { id: 'sneakers', label: 'White sneakers', value: 30, valueLabel: '30' },
    { id: 'jeans', label: 'Straight jeans', value: 21, valueLabel: '21' },
    { id: 'blouse', label: 'White blouse', value: 9, valueLabel: '9' },
  ];

  test('renders every row label and value', async () => {
    await render(<HorizontalBars rows={rows} selectedId={null} onSelect={jest.fn()} />);
    expect(screen.getByText('White sneakers')).toBeOnTheScreen();
    expect(screen.getByText('30')).toBeOnTheScreen();
    expect(screen.getByText('Straight jeans')).toBeOnTheScreen();
    expect(screen.getByText('21')).toBeOnTheScreen();
    expect(screen.getByText('White blouse')).toBeOnTheScreen();
    expect(screen.getByText('9')).toBeOnTheScreen();
  });

  test('each row is an accessible button with the label as its name', async () => {
    await render(<HorizontalBars rows={rows} selectedId={null} onSelect={jest.fn()} />);
    expect(screen.getByRole('button', { name: /White sneakers/ })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /Straight jeans/ })).toBeOnTheScreen();
  });

  test('tapping a row calls onSelect with its id', async () => {
    const onSelect = jest.fn();
    await render(<HorizontalBars rows={rows} selectedId={null} onSelect={onSelect} />);
    await fireEvent.press(screen.getByRole('button', { name: /Straight jeans/ }));
    expect(onSelect).toHaveBeenCalledWith('jeans');
  });

  test('the selected row exposes accessibilityState.selected and shows its detail', async () => {
    await render(
      <HorizontalBars
        rows={rows}
        selectedId="jeans"
        onSelect={jest.fn()}
        detail="21 wears · last: yesterday"
      />,
    );
    const selectedButton = screen.getByRole('button', { name: /Straight jeans/ });
    expect(selectedButton).toBeSelected();
    expect(screen.getByText('21 wears · last: yesterday')).toBeOnTheScreen();
    const unselectedButton = screen.getByRole('button', { name: /White sneakers/ });
    expect(unselectedButton).not.toBeSelected();
  });

  test('no detail is shown when nothing is selected', async () => {
    await render(<HorizontalBars rows={rows} selectedId={null} onSelect={jest.fn()} detail="21 wears" />);
    expect(screen.queryByText('21 wears')).toBeNull();
  });

  test('without onSelect the rows are read-only, each one labeled', async () => {
    await render(<HorizontalBars rows={rows} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByLabelText('Straight jeans, 21')).toBeOnTheScreen();
  });

  test('valueWidth widens the value column', async () => {
    await render(<HorizontalBars rows={rows} onSelect={jest.fn()} valueWidth={62} />);
    expect(screen.getByText('30')).toHaveStyle({ width: 62 });
  });

  test('at a large text size the label and value columns grow with the text, up to the 1.5x cap', async () => {
    mockWindow.fontScale = 3.1;
    await render(<HorizontalBars rows={rows} onSelect={jest.fn()} valueWidth={62} />);
    expect(screen.getByText('30')).toHaveStyle({ width: 93 });
    expect(screen.getByText('30')).toHaveProp('maxFontSizeMultiplier', 1.5);
    expect(screen.getByText('White sneakers')).toHaveStyle({ width: 138 });
    expect(screen.getByText('White sneakers')).toHaveProp('maxFontSizeMultiplier', 1.5);
  });

  test('a smaller text size keeps the default columns', async () => {
    mockWindow.fontScale = 0.85;
    await render(<HorizontalBars rows={rows} valueWidth={62} />);
    expect(screen.getByText('30')).toHaveStyle({ width: 62 });
    expect(screen.getByText('White sneakers')).toHaveStyle({ width: 92 });
  });

  // Regression test: `Bar` used to read its reanimated shared value
  // straight into a plain style object during render. `withTiming`'s write happens on the UI
  // thread and never triggers a React re-render, so on a real device every bar stayed frozen at
  // its first-render width (0%, since reduced motion is off by default) — only `useAnimatedStyle`
  // re-evaluates the width worklet. This needs `useAnimatedStyle`'s mock to actually re-invoke the
  // style factory (see src/test/reanimatedMock.ts); the old hand-rolled mock's synchronous
  // `withTiming` hid the bug because it returned the target value immediately, so a plain style
  // read during the same render already saw the final width.
  test("a bar fill settles at its row's percentage of the max value", async () => {
    const maxRows = [
      { id: 'max', label: 'Max row', value: 30, valueLabel: '30' },
      { id: 'half', label: 'Half row', value: 15, valueLabel: '15' },
    ];
    await render(<HorizontalBars rows={maxRows} selectedId={null} onSelect={jest.fn()} />);
    const maxFill = screen.getByTestId('bar-fill-max');
    const halfFill = screen.getByTestId('bar-fill-half');
    const maxStyle = maxFill.props.style as { width?: string }[] | { width?: string };
    const halfStyle = halfFill.props.style as { width?: string }[] | { width?: string };
    const maxWidth = Array.isArray(maxStyle) ? maxStyle.find((s) => s.width !== undefined)?.width : maxStyle.width;
    const halfWidth = Array.isArray(halfStyle) ? halfStyle.find((s) => s.width !== undefined)?.width : halfStyle.width;
    expect(maxWidth).toBe('100%');
    expect(halfWidth).toBe('50%');
  });
});

describe('ProportionBar', () => {
  const segments = [
    { id: 'black', label: 'Black', pct: 24, hex: '#1f1f24' },
    { id: 'blue', label: 'Blue', pct: 18, hex: '#3b5b8c' },
    { id: 'white', label: 'White', pct: 15, hex: '#ffffff' },
    { id: 'camel', label: 'Camel', pct: 12, hex: '#c8a27a' },
    { id: 'olive', label: 'Olive', pct: 9, hex: '#6b7a3a' },
    { id: 'other', label: 'Other', pct: 22, hex: '#d4d0dc' },
  ];

  test('segment widths follow pct', async () => {
    await render(<ProportionBar segments={segments} onSelect={jest.fn()} />);
    const blackSegment = screen.getByTestId('proportion-segment-black', { includeHiddenElements: true });
    const oliveSegment = screen.getByTestId('proportion-segment-olive', { includeHiddenElements: true });
    const blackStyle = blackSegment.props.style as { flex?: number } | { flex?: number }[];
    const oliveStyle = oliveSegment.props.style as { flex?: number } | { flex?: number }[];
    const blackFlex = Array.isArray(blackStyle) ? blackStyle.find((s) => s.flex !== undefined)?.flex : blackStyle.flex;
    const oliveFlex = Array.isArray(oliveStyle) ? oliveStyle.find((s) => s.flex !== undefined)?.flex : oliveStyle.flex;
    expect(blackFlex).toBe(24);
    expect(oliveFlex).toBe(9);
  });

  function flattenStyle(style: unknown): Record<string, unknown> {
    const list: unknown[] = Array.isArray(style) ? style : [style];
    let flat: Record<string, unknown> = {};
    for (const entry of list) {
      if (entry !== null && entry !== undefined && typeof entry === 'object') {
        flat = { ...flat, ...(entry as Record<string, unknown>) };
      }
    }
    return flat;
  }

  test('a light segment such as white gets a hairline border', async () => {
    await render(<ProportionBar segments={segments} onSelect={jest.fn()} />);
    const whiteStyle = flattenStyle(screen.getByTestId('proportion-segment-white', { includeHiddenElements: true }).props.style);
    const blackStyle = flattenStyle(screen.getByTestId('proportion-segment-black', { includeHiddenElements: true }).props.style);
    expect(whiteStyle.borderWidth).toBeGreaterThan(0);
    expect(blackStyle.borderWidth === undefined || blackStyle.borderWidth === 0).toBe(true);
  });

  test('the legend lists each segment as "Label pct%" with a swatch', async () => {
    await render(<ProportionBar segments={segments} onSelect={jest.fn()} />);
    expect(screen.getByText('Black 24%')).toBeOnTheScreen();
    expect(screen.getByText('Blue 18%')).toBeOnTheScreen();
    expect(screen.getByText('White 15%')).toBeOnTheScreen();
    expect(screen.getByText('Other 22%')).toBeOnTheScreen();
  });

  test('each segment and legend entry calls onSelect with its id', async () => {
    const onSelect = jest.fn();
    await render(<ProportionBar segments={segments} onSelect={onSelect} />);
    const segmentButton = screen.getByTestId('proportion-segment-black', { includeHiddenElements: true });
    const legendButton = screen.getByTestId('proportion-legend-blue');
    expect(legendButton).toHaveAccessibleName('Blue 18%');
    await fireEvent.press(segmentButton);
    expect(onSelect).toHaveBeenCalledWith('black');
    onSelect.mockClear();
    await fireEvent.press(legendButton);
    expect(onSelect).toHaveBeenCalledWith('blue');
  });

  test('a screen reader reads each color once, through the legend, not again through the bar', async () => {
    await render(<ProportionBar segments={segments} onSelect={jest.fn()} />);
    expect(screen.getAllByRole('button').map((button) => button.props.accessibilityLabel as string)).toEqual([
      'Black 24%',
      'Blue 18%',
      'White 15%',
      'Camel 12%',
      'Olive 9%',
      'Other 22%',
    ]);
    expect(screen.queryByTestId('proportion-segment-black')).toBeNull();
    expect(screen.getByTestId('proportion-segment-black', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  test('segment and legend hit targets meet the 44pt minimum', async () => {
    await render(<ProportionBar segments={segments} onSelect={jest.fn()} />);
    const legendButton = screen.getByTestId('proportion-legend-black');
    const hitSlop = legendButton.props.hitSlop as { top?: number; bottom?: number } | undefined;
    const style = flattenStyle(legendButton.props.style);
    const minHeight = typeof style.minHeight === 'number' ? style.minHeight : 0;
    const effectiveHeight = minHeight + (hitSlop?.top ?? 0) + (hitSlop?.bottom ?? 0);
    expect(effectiveHeight).toBeGreaterThanOrEqual(44);
  });
});

describe('KpiTile', () => {
  test('renders the big value and the small label', async () => {
    await render(<KpiTile value="62%" label="of your closet worn this month" />);
    expect(screen.getByText('62%')).toBeOnTheScreen();
    expect(screen.getByText('of your closet worn this month')).toBeOnTheScreen();
  });

  test('a screen reader reads the value and its label as one element', async () => {
    await render(<KpiTile value="62%" label="of your closet worn this month" />);
    expect(screen.getByLabelText('62% of your closet worn this month')).toHaveProp('accessible', true);
  });
});
