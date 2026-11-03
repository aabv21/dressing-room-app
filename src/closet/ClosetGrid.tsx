import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { memo, useCallback, useState } from 'react';
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

const GridCell = memo(function GridCell({
  item,
  locale,
  onPress,
}: {
  item: GridItem;
  locale: Locale;
  onPress?: ((id: string) => void) | undefined;
}): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  const wearCountText = formatWearCount(item.wearCount, locale);

  const onError = useCallback(() => {
    setFailed(true);
  }, []);

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
  onPressItem?: (id: string) => void;
  onScrollActiveChange?: (active: boolean) => void;
}): React.JSX.Element {
  const { items, onPressItem, onScrollActiveChange } = props;
  const { t, locale } = useI18n();

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
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{t('grid.empty', { count: 10 })}</Text>
      </View>
    );
  }

  return (
    <FlashList
      data={items}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      numColumns={NUM_COLUMNS}
      onScrollBeginDrag={onScrollBegin}
      onScrollEndDrag={onScrollEndDrag}
      onMomentumScrollBegin={onScrollBegin}
      onMomentumScrollEnd={onScrollEnd}
      contentContainerStyle={styles.content}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.xs,
  },
  cell: {
    flex: 1,
    padding: 3,
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
  empty: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  emptyText: {
    color: colors.muted,
    textAlign: 'center',
  },
});
