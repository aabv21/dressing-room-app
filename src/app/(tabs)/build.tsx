// Build (mockup 01 screen 2): pick an outfit piece by piece. Slot rows show what's chosen; the active
// row's available garments fill the grid, filtered by category chips; "How does it look?" opens the
// rating once the outfit is complete. The selection lives in this tab's state, so it stays while
// the tab is mounted.
import { router } from 'expo-router';
import { Sparkles } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ClosetGrid } from '../../closet/ClosetGrid';
import { useCloset } from '../../closet/ClosetProvider';
import { toGridItems } from '../../closet/closetSelectors';
import { GARMENT_CATEGORIES, slotOf, type GarmentCategory, type Slot } from '../../closet/catalog';
import { useI18n } from '../../i18n';
import {
  canRate,
  retainSelection,
  selectGarment,
  selectionIds,
  type BuildSelection,
} from '../../outfits/buildSelection';
import { pieceLabel } from '../../outfits/outfitDisplay';
import type { AnchoredCta } from '../../ui/AnchoredCta';
import { ChipGroup } from '../../ui/ChipGroup';
import { Screen, ScreenTitle, useScreenContentInsets } from '../../ui/Screen';
import { useLargeText } from '../../ui/layout';
import { colors, layout, selectionRing, spacing } from '../../ui/theme';

type RowKey = 'top' | 'bottom' | 'shoes' | 'extra';

type Row = { key: RowKey; slots: readonly Slot[]; optional: boolean };

/** The slot rows, top to bottom. A one-piece is picked in the Bottom row and then stands in for both. */
const TOP_ROW: Row = { key: 'top', slots: ['top'], optional: false };
const ROWS: readonly Row[] = [
  TOP_ROW,
  { key: 'bottom', slots: ['bottom', 'one_piece'], optional: false },
  { key: 'shoes', slots: ['shoes'], optional: false },
  { key: 'extra', slots: ['outerwear', 'bag', 'headwear', 'accessory'], optional: true },
];

// ChipGroup's chips are 36 pt tall with hitSlop up to the 44 pt minimum.
const CHIP_SLOP = (layout.minHitTarget - 36) / 2;

function rowOf(key: RowKey): Row {
  return ROWS.find((row) => row.key === key) ?? TOP_ROW;
}

function SlotRow({
  label,
  value,
  chosen,
  active,
  onPress,
}: {
  label: string;
  value: string;
  chosen: boolean;
  active: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  // At the largest text sizes the value goes whole under the label instead of being cut to one line.
  const largeText = useLargeText();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      accessibilityHint={t('build.slot.hint')}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.slot,
        largeText ? styles.slotStacked : null,
        chosen ? null : styles.slotEmpty,
        active ? styles.slotActive : null,
      ]}
    >
      <Text style={styles.slotLabel}>{label}</Text>
      <Text style={chosen ? styles.slotValue : styles.slotPlaceholder} {...(largeText ? {} : { numberOfLines: 1 })}>
        {value}
      </Text>
    </Pressable>
  );
}

export default function BuildScreen(): React.JSX.Element {
  const { t } = useI18n();
  const insets = useScreenContentInsets();
  const { garments, thumbUrls } = useCloset();
  const [picked, setPicked] = useState<BuildSelection>({});
  const [activeKey, setActiveKey] = useState<RowKey>('top');
  const [category, setCategory] = useState<GarmentCategory | 'all'>('all');

  const available = useMemo(
    () => garments.filter((item) => item.status === 'available' && item.category !== null),
    [garments],
  );
  const byId = useMemo(() => new Map(available.map((item) => [item.id, item])), [available]);
  const usable = useMemo(() => new Set(byId.keys()), [byId]);
  // A piece deleted or sent to the laundry elsewhere leaves the outfit.
  const selection = useMemo(() => retainSelection(picked, usable), [picked, usable]);
  // A piece that left (the laundry, lent, deleted) leaves the picks too, so it isn't picked again
  // behind the user's back when it comes back. Adjusted while rendering, when the closet changes.
  const [prunedFor, setPrunedFor] = useState(usable);
  if (prunedFor !== usable) {
    setPrunedFor(usable);
    setPicked(retainSelection(picked, usable));
  }
  // The chosen garments, in slot order.
  const chosen = useMemo(() => selectionIds(selection).flatMap((id) => byId.get(id) ?? []), [selection, byId]);
  const selectedIds = useMemo(() => new Set(chosen.map((item) => item.id)), [chosen]);

  const onePiece = selection.one_piece !== undefined;
  const visibleRows = onePiece ? ROWS.filter((row) => row.key !== 'top') : ROWS;
  // The Top row hides behind a chosen one-piece; its slot is the Bottom row's then.
  const active = rowOf(activeKey === 'top' && onePiece ? 'bottom' : activeKey);

  const rowGarments = useMemo(
    () => available.filter((item) => item.category !== null && active.slots.includes(slotOf(item.category))),
    [available, active],
  );
  const categories = useMemo(() => {
    const present = new Set(rowGarments.map((item) => item.category));
    return GARMENT_CATEGORIES.filter((value) => present.has(value));
  }, [rowGarments]);
  // A filter whose last piece just left (laundry, delete) falls back to everything.
  const activeCategory = category !== 'all' && !categories.includes(category) ? 'all' : category;

  const items = useMemo(
    () =>
      toGridItems(
        activeCategory === 'all' ? rowGarments : rowGarments.filter((item) => item.category === activeCategory),
        thumbUrls,
        'all',
        t,
      ),
    [rowGarments, activeCategory, thumbUrls, t],
  );

  const chipOptions = useMemo(
    () => [
      { value: 'all' as const, label: t('build.chip.all') },
      ...categories.map((value) => ({ value, label: t(`garment.category.${value}`) })),
    ],
    [categories, t],
  );

  const onChipChange = useCallback((next: (GarmentCategory | 'all')[]) => {
    // Tapping the selected chip clears a single-select ChipGroup; that means "All" here.
    setCategory(next[0] ?? 'all');
  }, []);

  const onPressItem = useCallback(
    (id: string) => {
      const item = byId.get(id);
      if (item === undefined) return;
      setPicked((previous) => selectGarment(retainSelection(previous, usable), item));
    },
    [byId, usable],
  );

  const rowValue = (row: Row): { value: string; chosen: boolean } => {
    const pieces = chosen
      .filter((item) => item.category !== null && row.slots.includes(slotOf(item.category)))
      .map((item) => pieceLabel(item, t));
    if (pieces.length > 0) return { value: `${pieces.join(', ')} ✓`, chosen: true };
    return { value: row.optional ? t('build.optional') : t('build.pick'), chosen: false };
  };

  const rowLabel = (row: Row): string => {
    return row.key === 'bottom' && onePiece ? t('build.slot.one_piece') : t(`build.slot.${row.key}`);
  };

  const header = (
    <View style={styles.header}>
      <ScreenTitle title={t('screen.build')} />
      <View style={styles.rows}>
        {visibleRows.map((row) => {
          const { value, chosen: isChosen } = rowValue(row);
          return (
            <SlotRow
              key={row.key}
              label={rowLabel(row)}
              value={value}
              chosen={isChosen}
              active={row.key === active.key}
              onPress={() => {
                setActiveKey(row.key);
                setCategory('all');
              }}
            />
          );
        })}
      </View>
      {categories.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipRow}
          contentContainerStyle={styles.chipRowContent}
        >
          <ChipGroup
            options={chipOptions}
            selected={[activeCategory]}
            onChange={onChipChange}
            multiple={false}
            wrap={false}
            accessibilityLabel={t('build.filter')}
          />
        </ScrollView>
      ) : null}
    </View>
  );

  const complete = canRate(selection);
  const ids = selectionIds(selection).join(',');
  const cta = useMemo<React.ComponentProps<typeof AnchoredCta>>(
    () => ({
      primary: {
        label: t('build.rate'),
        tone: 'ai',
        icon: Sparkles,
        disabled: !complete,
        onPress: () => {
          router.push({ pathname: '/rate', params: { ids } });
        },
      },
    }),
    [t, complete, ids],
  );

  return (
    <Screen scroll={false} cta={cta}>
      <ClosetGrid
        items={items}
        header={header}
        contentInset={insets}
        onPressItem={onPressItem}
        selectedIds={selectedIds}
        emptyText={t('build.empty')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.sm + 2,
  },
  rows: {
    gap: 6,
  },
  // Mockup 01's `.slot`, at least 44 pt tall to be tapped.
  slot: {
    minHeight: layout.minHitTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 13,
  },
  slotStacked: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 2,
  },
  // `.slot.empty`: no fill, a dashed outline.
  slotEmpty: {
    backgroundColor: 'transparent',
    borderStyle: 'dashed',
    borderColor: colors.dashed,
  },
  slotActive: {
    borderColor: colors.accent,
    boxShadow: selectionRing,
  },
  slotLabel: {
    color: colors.muted,
    fontSize: 13,
  },
  slotValue: {
    flexShrink: 1,
    color: colors.ink,
    fontSize: 14,
    fontWeight: '700',
  },
  slotPlaceholder: {
    flexShrink: 1,
    color: colors.muted,
    fontSize: 13,
  },
  // Bleeds to the screen edges so chips scroll out under them (the Closet tab's chip row).
  chipRow: {
    marginHorizontal: -spacing.md,
    marginVertical: -CHIP_SLOP,
  },
  chipRowContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: CHIP_SLOP,
  },
});
