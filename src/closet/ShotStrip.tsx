import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { useI18n } from '../i18n';

import { colors, layout } from '../ui/theme';

const TILE_SIZE = 34;
const OVERLAP = -10;
const VISIBLE_SHOTS = 5;

/**
 * Mockup 02 screen 2's `.strip`: the most recent shots as overlapping 34 pt squares, newest on top
 * (CSS flow stacks later siblings above earlier ones; `zIndex` recreates that under RN's own
 * paint order). Only the last 5 are kept on screen — older shots still count toward the total, just
 * not shown — since the strip has no scroll affordance in the mockup.
 */
export function ShotStrip({ uris, onRemoveLast }: { uris: readonly string[]; onRemoveLast?: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const firstVisibleIndex = Math.max(0, uris.length - VISIBLE_SHOTS);
  const visible = uris.slice(firstVisibleIndex);
  const strip = (
    // Decorative: the camera's shot counter already says how many photos there are, and the tiles
    // have nothing to name, so screen readers skip them.
    <View
      style={styles.row}
      testID="shot-strip"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {visible.map((uri, offset) => {
        // Keyed by the shot's position in the full list (not the URI, which the same photo could
        // repeat, and not the on-screen offset, which shifts every shot left as new ones arrive).
        const shotIndex = firstVisibleIndex + offset;
        return (
          <View
            key={shotIndex}
            style={[styles.tile, offset === 0 ? styles.firstTile : null, { zIndex: offset }]}
          >
            <Image source={{ uri }} style={styles.image} testID={`shot-strip-tile-${String(offset)}`} />
          </View>
        );
      })}
    </View>
  );
  if (onRemoveLast === undefined || uris.length === 0) return strip;
  // The newest tile doubles as an undo: a blurry or double shot comes off before it becomes a garment.
  return (
    <View>
      {strip}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('camera.removeLast')}
        onPress={onRemoveLast}
        hitSlop={(layout.minHitTarget - TILE_SIZE) / 2}
        style={styles.removeLast}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  },
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#0e0d12',
    marginLeft: OVERLAP,
    overflow: 'hidden',
    backgroundColor: colors.commit,
  },
  firstTile: {
    marginLeft: 0,
  },
  removeLast: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: TILE_SIZE,
    height: TILE_SIZE,
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
