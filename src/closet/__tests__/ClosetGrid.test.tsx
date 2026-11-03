import { fireEvent, render, screen } from '@testing-library/react-native';

import { ClosetGrid } from '../ClosetGrid';

// FlashList's native RecyclerView binding crashes under jest-expo (it reaches into
// react-native's dev-menu lazy getters, which aren't present in the test environment). FlashList's
// own testing guide (https://shopify.github.io/flash-list/docs/guides/testing) recommends mocking
// it to a plain list that maps `data` through `renderItem`, which is enough to exercise this
// component's own rendering logic (cells, empty state, image failure) without FlashList's native
// virtualization. The scroll event props are forwarded onto a plain `ScrollView` so tests can
// fire `onScrollBeginDrag`/`onScrollEndDrag`/`onMomentumScrollBegin`/`onMomentumScrollEnd` the
// same way RNTL fires any other native event.
jest.mock('@shopify/flash-list', () => {
  const { ScrollView, View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    FlashList: ({
      data,
      renderItem,
      keyExtractor,
      onScrollBeginDrag,
      onScrollEndDrag,
      onMomentumScrollBegin,
      onMomentumScrollEnd,
    }: {
      data: readonly unknown[];
      renderItem: (info: { item: unknown; index: number }) => React.ReactElement | null;
      keyExtractor?: (item: unknown, index: number) => string;
      onScrollBeginDrag?: () => void;
      onScrollEndDrag?: () => void;
      onMomentumScrollBegin?: () => void;
      onMomentumScrollEnd?: () => void;
    }) => (
      <ScrollView
        testID="flash-list"
        onScrollBeginDrag={onScrollBeginDrag}
        onScrollEndDrag={onScrollEndDrag}
        onMomentumScrollBegin={onMomentumScrollBegin}
        onMomentumScrollEnd={onMomentumScrollEnd}
      >
        {data.map((item, index) => (
          <View key={keyExtractor ? keyExtractor(item, index) : index}>
            {renderItem({ item, index })}
          </View>
        ))}
      </ScrollView>
    ),
  };
});

test('empty closet shows the friendly empty state', async () => {
  await render(<ClosetGrid items={[]} />);
  expect(screen.getByText('Add your 10 favorites to get started.')).toBeOnTheScreen();
});

test('cells spell out wear counts and keep their label when the image fails', async () => {
  await render(
    <ClosetGrid
      items={[
        { id: 'a', thumbUri: 'http://127.0.0.1:1/missing.webp', wearCount: 0, label: 'Blouse' },
        { id: 'b', thumbUri: 'http://127.0.0.1:1/missing.webp', wearCount: 21, label: 'Jeans' },
      ]}
    />,
  );
  expect(screen.getByText('never worn')).toBeOnTheScreen();
  expect(screen.getByText('21 wears')).toBeOnTheScreen();
  expect(screen.getByLabelText('Blouse, never worn')).toBeOnTheScreen();
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
