// The image an outfit is shared as: the pieces' cut-out thumbnails stacked as a look on a light
// background, the score when known, and a small "Dressing Room" footer.
import { Image } from 'expo-image';
import { forwardRef, useMemo } from 'react';
import { StyleSheet, Text, View, type ViewInstance } from 'react-native';

import type { Garment } from '../closet/garmentRepository';
import { useI18n } from '../i18n';
import { colors, fontSizes, radii, spacing } from '../ui/theme';
import { orderPieces } from './outfitDisplay';

const CARD_WIDTH = 300;
// Three pieces or fewer get larger thumbnails; a fuller outfit still fits on one phone screen.
const LARGE_PIECE = 120;
const SMALL_PIECE = 84;
const LARGE_UP_TO = 3;

/** `ref` is the view `captureRef` turns into the PNG; `collapsable={false}` keeps it on Android. */
export const ShareCard = forwardRef<ViewInstance, { garments: readonly Garment[]; thumbUrls: Map<string, string>; score: number | null }>(
  function ShareCard({ garments, thumbUrls, score }, ref) {
    const { t } = useI18n();
    const ordered = useMemo(() => orderPieces(garments), [garments]);
    const size = ordered.length <= LARGE_UP_TO ? LARGE_PIECE : SMALL_PIECE;
    return (
      <View ref={ref} collapsable={false} style={styles.card} testID="share-card">
        {score === null ? null : (
          <View style={styles.score}>
            <Text style={styles.scoreValue}>{String(score)}</Text>
            <Text style={styles.scoreLabel}>{t('share.score')}</Text>
          </View>
        )}
        <View style={styles.look}>
          {ordered.map((garment) => {
            const uri = thumbUrls.get(garment.id);
            return (
              <View key={garment.id} style={{ width: size, height: size }} testID={`share-piece-${garment.id}`}>
                {uri === undefined ? null : (
                  <Image
                    source={{ uri, cacheKey: `${garment.id}:thumb:${String(garment.photo_version)}` }}
                    style={styles.image}
                    cachePolicy="disk"
                    contentFit="contain"
                    accessibilityIgnoresInvertColors
                  />
                )}
              </View>
            );
          })}
        </View>
        <Text style={styles.footer}>Dressing Room</Text>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    alignSelf: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.thumbFill,
  },
  score: {
    alignSelf: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: radii.cell,
    backgroundColor: colors.surface,
  },
  scoreValue: {
    color: colors.accentText,
    fontSize: fontSizes.headline,
    fontWeight: '800',
  },
  scoreLabel: {
    color: colors.muted,
    fontSize: fontSizes.micro,
    fontWeight: '600',
  },
  look: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  image: {
    flex: 1,
  },
  footer: {
    color: colors.muted,
    fontSize: fontSizes.caption,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
