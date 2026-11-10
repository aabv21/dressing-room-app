import { fireEvent, render, screen } from '@testing-library/react-native';

import { ClosetGrid } from '../ClosetGrid';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return -- jest.mock()'s factory can only reference globals (incl. `require`), not a module-scoped import
jest.mock('@shopify/flash-list', () => require('../../test/flashListMock'));

test('empty closet shows the friendly empty state', async () => {
  await render(<ClosetGrid items={[]} />);
  expect(screen.getByText('Add your 10 favorites to get started.')).toBeOnTheScreen();
});

test('cells spell out wear counts', async () => {
  await render(
    <ClosetGrid
      items={[
        { id: 'a', thumbUri: 'http://127.0.0.1:1/a.webp', wearCount: 0, label: 'Blouse' },
        { id: 'b', thumbUri: 'http://127.0.0.1:1/b.webp', wearCount: 21, label: 'Jeans' },
      ]}
    />,
  );
  expect(screen.getByText('never worn')).toBeOnTheScreen();
  expect(screen.getByText('21 wears')).toBeOnTheScreen();
  expect(screen.getByLabelText('Blouse, never worn')).toBeOnTheScreen();
});

test('a cell keeps its placeholder and label when the image fails', async () => {
  await render(
    <ClosetGrid
      items={[{ id: 'a', thumbUri: 'http://127.0.0.1:1/missing.webp', wearCount: 0, label: 'Blouse' }]}
    />,
  );
  await fireEvent(screen.getByTestId('grid-thumb-a'), 'error', { nativeEvent: { error: '404' } });

  expect(screen.queryByTestId('grid-thumb-a')).not.toBeOnTheScreen();
  // The cell's own white background is the placeholder; it and the label stay put.
  expect(screen.getByLabelText('Blouse, never worn')).toHaveStyle({ backgroundColor: '#ffffff' });
  expect(screen.getByText('never worn')).toBeOnTheScreen();
});

test('a recycled cell shows the next item image after the previous one failed', async () => {
  const failing = { id: 'a', thumbUri: 'http://127.0.0.1:1/missing.webp', wearCount: 0, label: 'Blouse' };
  const next = { id: 'b', thumbUri: 'http://127.0.0.1:1/ok.webp', wearCount: 1, label: 'Jeans' };
  const view = await render(<ClosetGrid items={[failing]} />);
  await fireEvent(screen.getByTestId('grid-thumb-a'), 'error', { nativeEvent: { error: '404' } });
  expect(screen.queryByTestId('grid-thumb-a')).not.toBeOnTheScreen();

  // Same position (same recycled cell instance), new item.
  await view.rerender(<ClosetGrid items={[next]} />);

  expect(screen.getByTestId('grid-thumb-b')).toBeOnTheScreen();
  expect(screen.getByLabelText('Jeans, 1 wear')).toBeOnTheScreen();
});

test('a drag released without momentum still reports scrolling as inactive', async () => {
  const onScrollActiveChange = jest.fn();
  await render(
    <ClosetGrid
      items={[{ id: 'a', thumbUri: 'http://127.0.0.1:1/missing.webp', wearCount: 1, label: 'Blouse' }]}
      onScrollActiveChange={onScrollActiveChange}
    />,
  );
  const list = screen.getByTestId('flash-list');

  await fireEvent(list, 'scrollBeginDrag');
  expect(onScrollActiveChange).toHaveBeenLastCalledWith(true);

  // A slow drag that's released with ~zero velocity never enters a momentum phase — only
  // `onScrollEndDrag` fires, no `onMomentumScrollBegin`/`onMomentumScrollEnd`.
  await fireEvent(list, 'scrollEndDrag');
  expect(onScrollActiveChange).toHaveBeenLastCalledWith(false);
});

test('the image source carries the cache key, so a re-signed URL still hits the disk cache', async () => {
  await render(
    <ClosetGrid items={[{ id: 'a', thumbUri: 'https://signed/a?token=1', cacheKey: 'a:thumb:2', wearCount: 0, label: 'Blouse' }]} />,
  );

  // expo-image normalizes a single source into a one-element array on the native view.
  expect(screen.getByTestId('grid-thumb-a')).toHaveProp('source', [{ uri: 'https://signed/a?token=1', cacheKey: 'a:thumb:2' }]);
});

test('a cell with no signed URL yet renders no image, only its label', async () => {
  await render(<ClosetGrid items={[{ id: 'a', thumbUri: '', wearCount: 0, label: 'New garment' }]} />);

  expect(screen.queryByTestId('grid-thumb-a')).not.toBeOnTheScreen();
  expect(screen.getByLabelText('New garment, never worn')).toBeOnTheScreen();
});

test('a status badge is shown and read out', async () => {
  await render(
    <ClosetGrid items={[{ id: 'a', thumbUri: 'https://x/a', wearCount: 2, label: 'Jeans', badge: 'In the laundry' }]} />,
  );

  expect(screen.getByText('In the laundry')).toBeOnTheScreen();
  expect(screen.getByLabelText('Jeans, In the laundry, 2 wears')).toBeOnTheScreen();
});

test('a leading tile renders before the first cell and is pressable', async () => {
  const onPress = jest.fn();
  await render(
    <ClosetGrid
      items={[{ id: 'a', thumbUri: 'https://x/a', wearCount: 0, label: 'Blouse' }]}
      leadingTile={{ label: 'Processing 3 photos…', onPress }}
    />,
  );

  const cells = screen.getAllByTestId(/^grid-(leading-tile|cell-)/);
  expect(cells.map((cell) => cell.props.testID as string)).toEqual(['grid-leading-tile', 'grid-cell-a']);
  await fireEvent.press(screen.getByRole('button', { name: 'Processing 3 photos…' }));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test('a leading tile alone still renders the grid instead of the empty state', async () => {
  await render(<ClosetGrid items={[]} leadingTile={{ label: 'Processing 1 photo…' }} />);

  expect(screen.getByText('Processing 1 photo…')).toBeOnTheScreen();
  expect(screen.queryByText('Add your 10 favorites to get started.')).not.toBeOnTheScreen();
});

test('selectedIds marks the chosen cells with a ring and as selected; without it no cell is', async () => {
  const items = [
    { id: 'a', thumbUri: '', wearCount: 6, label: 'Heels' },
    { id: 'b', thumbUri: '', wearCount: 30, label: 'Sneakers' },
  ];
  const view = await render(<ClosetGrid items={items} onPressItem={jest.fn()} selectedIds={new Set(['a'])} />);
  expect(screen.getByLabelText('Heels, 6 wears')).toBeSelected();
  expect(screen.getByLabelText('Sneakers, 30 wears')).not.toBeSelected();
  expect(screen.getByLabelText('Heels, 6 wears')).toHaveStyle({ borderColor: '#7c3aed' });

  await view.rerender(<ClosetGrid items={items} onPressItem={jest.fn()} />);
  expect(screen.getByLabelText('Heels, 6 wears')).not.toBeSelected();
  expect(screen.getByLabelText('Heels, 6 wears')).not.toHaveStyle({ borderColor: '#7c3aed' });
});

test('emptyText replaces the closet empty state', async () => {
  await render(<ClosetGrid items={[]} emptyText="No shoes available." />);
  expect(screen.getByText('No shoes available.')).toBeOnTheScreen();
  expect(screen.queryByText('Add your 10 favorites to get started.')).not.toBeOnTheScreen();
});
