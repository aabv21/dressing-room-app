// Mockup 01's stacked outfit (screen 1's `.item` rows): each piece's thumbnail, short label and
// wear count, outerwear first and shoes last. Rendered by Today's lucky card and the rate screen;
// the caller provides the surrounding card.
import { Image } from 'expo-image';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { Garment } from '../closet/garmentRepository';
import { formatWearCount, useI18n } from '../i18n';
import { colors, spacing } from '../ui/theme';
import { orderPieces, pieceLabel } from './outfitDisplay';

function PieceRow({
  garment,
  thumbUrl,
  compact,
}: {
  garment: Garment;
  thumbUrl: string | undefined;
  compact: boolean;
}): React.JSX.Element {
  const { t, locale } = useI18n();
  const label = pieceLabel(garment, t);
  const wears = formatWearCount(garment.wear_count, locale);
  const source = useMemo(
    () =>
      thumbUrl === undefined
        ? null
        : { uri: thumbUrl, cacheKey: `${garment.id}:thumb:${String(garment.photo_version)}` },
    [thumbUrl, garment.id, garment.photo_version],
  );
  return (
    <View
      style={[styles.row, compact ? styles.rowCompact : null]}
      accessible
      accessibilityLabel={`${label}, ${wears}`}
      testID={`outfit-piece-${garment.id}`}
    >
      <View style={[styles.thumb, compact ? styles.thumbCompact : null]}>
        {source === null ? null : (
          <Image
            source={source}
            style={styles.thumbImage}
            cachePolicy="disk"
            contentFit="contain"
            transition={100}
            accessibilityIgnoresInvertColors
          />
        )}
      </View>
      <View style={styles.text}>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.wears}>{wears}</Text>
      </View>
    </View>
  );
}

export function OutfitStack({
  garments,
  thumbUrls,
  compact = false,
}: {
  garments: Garment[];
  thumbUrls: Map<string, string>;
  compact?: boolean;
}): React.JSX.Element {
  const ordered = useMemo(() => orderPieces(garments), [garments]);
  return (
    <View style={[styles.stack, compact ? styles.stackCompact : null]}>
      {ordered.map((garment) => (
        <PieceRow key={garment.id} garment={garment} thumbUrl={thumbUrls.get(garment.id)} compact={compact} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.sm - 2,
  },
  stackCompact: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#ffffff',
    borderRadius: 13,
    paddingVertical: 7,
    paddingHorizontal: 9,
  },
  rowCompact: {
    paddingVertical: 5,
  },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.tint,
  },
  thumbCompact: {
    width: 36,
    height: 36,
  },
  thumbImage: {
    flex: 1,
  },
  text: {
    flex: 1,
    gap: 1,
  },
  label: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '600',
  },
  wears: {
    color: colors.muted,
    fontSize: 12,
  },
});
