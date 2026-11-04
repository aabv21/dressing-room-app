import { ScrollView, View } from 'react-native';

// FlashList's native RecyclerView binding crashes under jest-expo (it reaches into react-native's
// dev-menu lazy getters, which aren't present in the test environment). FlashList's own testing
// guide (https://shopify.github.io/flash-list/docs/guides/testing) recommends mocking it to a plain
// list that maps `data` through `renderItem`. Use it with:
//
//   jest.mock('@shopify/flash-list', () => require('../../test/flashListMock'));
//
// The stand-in is a `ScrollView` with testID `flash-list`, so tests can fire the scroll events
// (`scrollBeginDrag`, `scrollEndDrag`, `momentumScrollBegin`, `momentumScrollEnd`) on it.
//
// Cells are keyed by index, not by `keyExtractor`: FlashList v2 keys its view holders by render
// position and recycles them across items, so a cell instance must survive a change of `item`.
export function FlashList({
  data,
  renderItem,
  ListHeaderComponent,
  onScrollBeginDrag,
  onScrollEndDrag,
  onMomentumScrollBegin,
  onMomentumScrollEnd,
}: {
  data: readonly unknown[];
  renderItem: (info: { item: unknown; index: number }) => React.ReactElement | null;
  ListHeaderComponent?: React.ReactElement | null;
  onScrollBeginDrag?: () => void;
  onScrollEndDrag?: () => void;
  onMomentumScrollBegin?: () => void;
  onMomentumScrollEnd?: () => void;
}): React.JSX.Element {
  return (
    <ScrollView
      testID="flash-list"
      onScrollBeginDrag={onScrollBeginDrag}
      onScrollEndDrag={onScrollEndDrag}
      onMomentumScrollBegin={onMomentumScrollBegin}
      onMomentumScrollEnd={onMomentumScrollEnd}
    >
      {ListHeaderComponent ?? null}
      {data.map((item, index) => (
        <View key={index}>{renderItem({ item, index })}</View>
      ))}
    </ScrollView>
  );
}
