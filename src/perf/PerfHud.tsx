import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useI18n, type Locale } from '../i18n';
import { inferRefreshRateHz, type FrameStats } from './frameStats';

const LINE_HEIGHT = 14;
const PADDING_VERTICAL = 6;
const NOTICE_MS = 2500;

/** Fixed height (two lines, no font scaling) so the screen can reserve room for it. */
export const PERF_HUD_HEIGHT = LINE_HEIGHT * 2 + PADDING_VERTICAL * 2;

const oneDecimalFormats = new Map<Locale, Intl.NumberFormat>();

function formatOneDecimal(value: number, locale: Locale): string {
  let format = oneDecimalFormats.get(locale);
  if (format === undefined) {
    format = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
    oneDecimalFormats.set(locale, format);
  }
  return format.format(value);
}

async function clearImageCaches(): Promise<boolean> {
  try {
    const [memory, disk] = await Promise.all([Image.clearMemoryCache(), Image.clearDiskCache()]);
    return memory && disk;
  } catch {
    return false;
  }
}

/**
 * On-device perf readout for the performance gate build. Not part of the shipped UI: only rendered
 * when `EXPO_PUBLIC_PERF_FIXTURES_URL` is set, see `src/app/(tabs)/closet.tsx`.
 *
 * Tap resets the stats. Long-press also clears expo-image's memory and disk caches, so a cold
 * pass can be repeated without reinstalling (the disk cache survives reinstalls).
 */
export function PerfHud(props: { stats: FrameStats; onReset: () => void }): React.JSX.Element {
  const { stats, onReset } = props;
  const { t, locale } = useI18n();
  const insets = useSafeAreaInsets();
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (notice === null) {
      return undefined;
    }
    const timer = setTimeout(() => {
      setNotice(null);
    }, NOTICE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [notice]);

  const onLongPress = useCallback(() => {
    void clearImageCaches().then((cleared) => {
      onReset();
      setNotice(t(cleared ? 'perf.cacheCleared' : 'perf.cacheClearFailed'));
    });
  }, [onReset, t]);

  const text =
    notice ??
    t('perf.hud', {
      frames: stats.frames,
      dropped: stats.dropped,
      ratio: formatOneDecimal(stats.droppedRatio * 100, locale),
      p95: formatOneDecimal(stats.p95Ms, locale),
      median: formatOneDecimal(stats.medianMs, locale),
      hz: inferRefreshRateHz(stats.medianMs),
    });

  return (
    <Pressable
      testID="perf-hud"
      style={[styles.bar, { top: insets.top }]}
      onPress={onReset}
      onLongPress={onLongPress}
    >
      <Text style={styles.text} numberOfLines={2} allowFontScaling={false}>
        {text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: PERF_HUD_HEIGHT,
    paddingHorizontal: 12,
    paddingVertical: PADDING_VERTICAL,
    backgroundColor: 'rgba(20,19,23,0.85)',
    justifyContent: 'center',
    zIndex: 10,
  },
  text: {
    color: '#ffffff',
    fontSize: 11,
    lineHeight: LINE_HEIGHT,
    fontWeight: '600',
    textAlign: 'center',
  },
});
