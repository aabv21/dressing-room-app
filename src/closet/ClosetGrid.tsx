import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatWearCount, useI18n, type Locale } from '../i18n';
import { colors, radii, spacing } from '../ui/theme';

export type GridItem = {
  id: string;
  thumbUri: string;
  wearCount: number;
  label: string;
};

const NUM_COLUMNS = 3;
// Half of mockup 02's 6 pt grid gap. Each cell pads itself by this much, so neighbouring cells sit
// 6 pt apart; the list's horizontal padding is reduced by the same amount so the outer cell edges
// line up with the screen title.
const CELL_INSET = 3;

const GridCell = memo(function GridCell({
  item,
  locale,
  onPress,
}: {
  item: GridItem;
  locale: Locale;
  onPress?: ((id: string) => void) | undefined;
}): React.JSX.Element {
  // Keyed on the URI rather than a plain boolean: FlashList recycles this component instance for
  // other items, and a `failed` flag would otherwise hide every later item's image in this cell.
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const failed = failedUri === item.thumbUri;
  const wearCountText = formatWearCount(item.wearCount, locale);

  const onError = useCallback(() => {
    setFailedUri(item.thumbUri);
  }, [item.thumbUri]);

  const onCellPress = useCallback(() => {
    onPress?.(item.id);
  }, [onPress, item.id]);

  return (
    <View style={styles.cell}>
      <Pressable
        style={styles.cellInner}
        onPress={onPress ? onCellPress : undefined}
        accessibilityLabel={`${item.label}, ${wearCountText}`}
      >
        {failed ? null : (
          <Image
            source={{ uri: item.thumbUri }}
            style={styles.image}
            recyclingKey={item.id}
            cachePolicy="disk"
            contentFit="contain"
            transition={100}
            onError={onError}
            testID={`grid-thumb-${item.id}`}
            accessibilityIgnoresInvertColors
          />
        )}
        <Text style={styles.wearCount} numberOfLines={1}>
          {wearCountText}
        </Text>
      </Pressable>
    </View>
  );
});

export function ClosetGrid(props: {
  items: readonly GridItem[];
  /** Rendered above the cells and scrolls with them (FlashList's `ListHeaderComponent`). */
  header?: React.ReactElement;
  /** Content padding that keeps the first and last rows clear of overlaid chrome. */
  contentInset?: { top: number; bottom: number };
  onPressItem?: (id: string) => void;
  onScrollActiveChange?: (active: boolean) => void;
}): React.JSX.Element {
  const { items, header, contentInset, onPressItem, onScrollActiveChange } = props;
  const { t, locale } = useI18n();
  const insetTop = contentInset?.top ?? 0;
  const insetBottom = contentInset?.bottom ?? 0;

  const contentContainerStyle = useMemo(
    () => ({
      paddingTop: insetTop,
      paddingBottom: Math.max(0, insetBottom - CELL_INSET),
      paddingHorizontal: spacing.md - CELL_INSET,
    }),
    [insetTop, insetBottom],
  );

  const renderItem = useCallback(
    ({ item }: { item: GridItem }) => <GridCell item={item} locale={locale} onPress={onPressItem} />,
    [onPressItem, locale],
  );

  const keyExtractor = useCallback((item: GridItem) => item.id, []);

  const onScrollBegin = useCallback(() => {
    onScrollActiveChange?.(true);
  }, [onScrollActiveChange]);

  const onScrollEnd = useCallback(() => {
    onScrollActiveChange?.(false);
  }, [onScrollActiveChange]);

  // A drag released with ~zero velocity has no momentum phase, so `onMomentumScrollEnd` alone
  // would leave `active` stuck `true` and `useFrameStats` accumulating idle frames forever.
  // `onScrollEndDrag` clears it for that case; a drag that *does* carry into momentum gets a
  // following `onMomentumScrollBegin` that flips it back to `true`.
  const onScrollEndDrag = useCallback(() => {
    onScrollActiveChange?.(false);
  }, [onScrollActiveChange]);

  if (items.length === 0) {
    return (
      <View style={[styles.emptyScreen, { paddingTop: insetTop }]}>
        {header}
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{t('grid.empty', { count: 10 })}</Text>
        </View>
      </View>
    );
  }

  return (
    <FlashList
      data={items}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      numColumns={NUM_COLUMNS}
      ListHeaderComponent={header}
      ListHeaderComponentStyle={styles.header}
      onScrollBeginDrag={onScrollBegin}
      onScrollEndDrag={onScrollEndDrag}
      onMomentumScrollBegin={onScrollBegin}
      onMomentumScrollEnd={onScrollEnd}
      contentContainerStyle={contentContainerStyle}
    />
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: CELL_INSET,
    paddingBottom: spacing.sm - CELL_INSET,
  },
  cell: {
    flex: 1,
    padding: CELL_INSET,
  },
  cellInner: {
    aspectRatio: 1,
    backgroundColor: '#ffffff',
    borderRadius: radii.cell,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  wearCount: {
    position: 'absolute',
    bottom: 3,
    right: 6,
    fontSize: 9,
    color: colors.muted,
  },
  emptyScreen: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  empty: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  emptyText: {
    color: colors.muted,
    textAlign: 'center',
  },
});
