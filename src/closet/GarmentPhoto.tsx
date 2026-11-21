import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Path, Pattern, Rect } from 'react-native-svg';

import { useI18n } from '../i18n';
import { garmentPhotoPath, signedPhotoUrls, type Garment } from './garmentRepository';
import { colors } from '../ui/theme';

/**
 * Null until signed (or if signing failed). Re-signed on each `photo_version`: a replaced photo keeps its
 * path, so only a new URL gets past an HTTP or CDN cache of the old one.
 */
function useFullPhotoUrl(g: Pick<Garment, 'id' | 'user_id' | 'photo_version'>): string | null {
  const path = garmentPhotoPath(g.user_id, g.id, 'full');
  const version = g.photo_version;
  const [signed, setSigned] = useState<{ path: string; version: number; url: string } | null>(null);

  useEffect(() => {
    let current = true;
    signedPhotoUrls([path]).then(
      (urls) => {
        const url = urls.get(path);
        if (current && url !== undefined) {
          setSigned({ path, version, url });
        }
      },
      // Offline: the checkerboard stays empty and the fields still work.
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [path, version]);

  return signed !== null && signed.path === path && signed.version === version ? signed.url : null;
}

/**
 * The full photo over a checkerboard, cached by `photo_version`: a re-signed URL still hits the disk
 * cache and a replaced photo never shows the old one.
 */
export function GarmentPhoto({ garment }: { garment: Pick<Garment, 'id' | 'user_id' | 'photo_version'> }): React.JSX.Element {
  const { t } = useI18n();
  const url = useFullPhotoUrl(garment);
  const source = useMemo(
    () => (url === null ? null : { uri: url, cacheKey: `${garment.id}:full:${String(garment.photo_version)}` }),
    [url, garment.id, garment.photo_version],
  );
  return (
    <View style={styles.photo}>
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <Pattern id="checker" width={16} height={16} patternUnits="userSpaceOnUse">
            <Rect width={16} height={16} fill={colors.surface} />
            <Path d="M0 0h8v8H0zM8 8h8v8H8z" fill={colors.checker} />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#checker)" />
      </Svg>
      {source === null ? null : (
        <Image
          source={source}
          style={styles.photoImage}
          cachePolicy="disk"
          contentFit="contain"
          transition={100}
          accessible
          accessibilityRole="image"
          accessibilityLabel={t('garment.photo')}
          accessibilityIgnoresInvertColors
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  photo: {
    aspectRatio: 252 / 150,
    borderRadius: 16,
    overflow: 'hidden',
  },
  photoImage: {
    flex: 1,
  },
});
