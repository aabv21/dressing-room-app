import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatWearCount, useI18n, type Locale } from '../i18n';
import { colors, radii, selectionRing, spacing } from '../ui/theme';

export type GridItem = {
  id: string;
  /** Empty while the photo has no signed URL yet: the cell shows only its label and wear count. */
  thumbUri: string;
  /** expo-image's cache key; stable across re-signed URLs of the same photo version. */
  cacheKey?: string;
  wearCount: number;
  label: string;
  /** A short status shown on the cell (e.g. "In the laundry"). */
  badge?: string;
};

/** Mockup 02's `.g.proc` cell, rendered before the garments (e.g. "Processing 3 photos…"). */
export type LeadingTile = {
  label: string;
  tone?: 'progress' | 'error';
  onPress?: () => void;
};

const LEADING_KEY = '__leading__';
const MVCP_DISABLED = { disabled: true } as const;
type Cell = GridItem | typeof LEADING_KEY;

const NUM_COLUMNS = 3;
// Half of mockup 02's 6 pt grid gap. Each cell pads itself by this much, so neighbouring cells sit
// 6 pt apart; the list's horizontal padding is reduced by the same amount so the outer cell edges
// line up with the screen title.
const CELL_INSET = 3;

const GridCell = memo(function GridCell({
  item,
  locale,
  onPress,
  selected,
}: {
  item: GridItem;
  locale: Locale;
  onPress?: ((id: string) => void) | undefined;
  /** Undefined when the grid has no selection (the closet); otherwise whether this cell is chosen. */
  selected?: boolean | undefined;
}): React.JSX.Element {
  // Keyed on the URI rather than a plain boolean: FlashList recycles this component instance for
  // other items, and a `failed` flag would otherwise hide every later item's image in this cell.
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const showImage = item.thumbUri !== '' && failedUri !== item.thumbUri;
  const wearCountText = formatWearCount(item.wearCount, locale);
  const source = useMemo(
    () => (item.cacheKey === undefined ? { uri: item.thumbUri } : { uri: item.thumbUri, cacheKey: item.cacheKey }),
    [item.thumbUri, item.cacheKey],
  );

  const onError = useCallback(() => {
    setFailedUri(item.thumbUri);
  }, [item.thumbUri]);

  const onCellPress = useCallback(() => {
    onPress?.(item.id);
  }, [onPress, item.id]);

  const accessibilityLabel = [item.label, item.badge, wearCountText].filter((part) => part !== undefined).join(', ');

  return (
    <View style={styles.cell} testID={`grid-cell-${item.id}`}>
      <Pressable
        style={[styles.cellInner, selected === true ? styles.cellSelected : null]}
        onPress={onPress ? onCellPress : undefined}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={selected === undefined ? undefined : { selected }}
      >
        {showImage ? (
          <Image
            source={source}
            style={styles.image}
            recyclingKey={item.id}
            cachePolicy="disk"
            contentFit="contain"
            transition={100}
            onError={onError}
            testID={`grid-thumb-${item.id}`}
            accessibilityIgnoresInvertColors
          />
        ) : null}
        {item.badge === undefined ? null : (
          <Text style={styles.badge} numberOfLines={1}>
            {item.badge}
          </Text>
        )}
        <Text style={styles.wearCount} numberOfLines={1}>
          {wearCountText}
        </Text>
      </Pressable>
    </View>
  );
});

function LeadingCell({ tile }: { tile: LeadingTile }): React.JSX.Element {
  const error = tile.tone === 'error';
  return (
    <View style={styles.cell} testID="grid-leading-tile">
      <Pressable
        style={[styles.cellInner, styles.leading, error ? styles.leadingError : null]}
        onPress={tile.onPress}
        disabled={tile.onPress === undefined}
        accessibilityRole={tile.onPress ? 'button' : undefined}
        accessibilityLabel={tile.label}
      >
        <Text style={[styles.leadingText, error ? styles.leadingTextError : null]}>{tile.label}</Text>
      </Pressable>
    </View>
  );
}

export function ClosetGrid(props: {
  items: readonly GridItem[];
  /** Rendered above the cells and scrolls with them (FlashList's `ListHeaderComponent`). */
  header?: React.ReactElement;
  /** Content padding that keeps the first and last rows clear of overlaid chrome. */
  contentInset?: { top: number; bottom: number };
  onPressItem?: (id: string) => void;
  onScrollActiveChange?: (active: boolean) => void;
  /** A status cell placed before the garments; with it, an empty closet still renders the grid. */
  leadingTile?: LeadingTile;
  /** Cells to show as chosen (an accent ring and `accessibilityState.selected`); unset, cells have no selection state. */
  selectedIds?: ReadonlySet<string>;
  /** The text shown when there are no cells; defaults to the closet's "add your favorites". */
  emptyText?: string;
}): React.JSX.Element {
  const { items, header, contentInset, onPressItem, onScrollActiveChange, leadingTile, selectedIds, emptyText } = props;
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

  const data = useMemo<readonly Cell[]>(
    () => (leadingTile === undefined ? items : [LEADING_KEY, ...items]),
    [items, leadingTile],
  );

  const renderItem = useCallback(
    ({ item }: { item: Cell }) =>
      item === LEADING_KEY ? (
        leadingTile === undefined ? null : <LeadingCell tile={leadingTile} />
      ) : (
        <GridCell item={item} locale={locale} onPress={onPressItem} selected={selectedIds?.has(item.id)} />
      ),
    [onPressItem, locale, leadingTile, selectedIds],
  );

  const keyExtractor = useCallback((item: Cell) => (item === LEADING_KEY ? LEADING_KEY : item.id), []);
  const getItemType = useCallback((item: Cell) => (item === LEADING_KEY ? 'leading' : 'garment'), []);

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

  if (data.length === 0) {
    return (
      <View style={[styles.emptyScreen, { paddingTop: insetTop }]}>
        {header}
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{emptyText ?? t('grid.empty', { count: 10 })}</Text>
        </View>
      </View>
    );
  }

  return (
    <FlashList
      data={data}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      getItemType={getItemType}
      // New garments and the leading tile arrive at the top. FlashList's default anchoring keeps
      // the first visible cell in place, which scrolled the title and goal card off-screen on every
      // upload; the closet reads top-down, so the content stays put instead.
      maintainVisibleContentPosition={MVCP_DISABLED}
      // The selection lives outside `data`, so a change must still re-render the visible cells.
      extraData={selectedIds}
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
  // Mockup 01's `.g.sel`: a 2 pt violet border with a soft halo.
  cellSelected: {
    borderWidth: 2,
    borderColor: colors.accent,
    boxShadow: selectionRing,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  badge: {
    position: 'absolute',
    top: 4,
    left: 4,
    maxWidth: '90%',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.pill,
    overflow: 'hidden',
    backgroundColor: colors.tint,
    color: colors.accentText,
    fontSize: 9,
    fontWeight: '700',
  },
  leading: {
    backgroundColor: colors.tint,
    padding: spacing.sm,
  },
  leadingError: {
    backgroundColor: colors.errorTint,
  },
  leadingText: {
    color: colors.accentText,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 13,
    textAlign: 'center',
  },
  leadingTextError: {
    color: colors.error,
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
