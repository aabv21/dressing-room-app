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
