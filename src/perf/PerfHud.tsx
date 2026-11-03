import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../i18n';
import type { FrameStats } from './frameStats';

/**
 * On-device perf readout for the gate build (Task 7). Not part of the shipped UI: only rendered
 * when `EXPO_PUBLIC_PERF_FIXTURES_URL` is set, see `src/app/(tabs)/closet.tsx`.
 */
export function PerfHud(props: { stats: FrameStats; onReset: () => void }): React.JSX.Element {
  const { stats, onReset } = props;
  const { t, locale } = useI18n();
  const ratioPercent = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
    stats.droppedRatio * 100,
  );
  const p95 = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(stats.p95Ms);

  const text = t('perf.hud', {
    frames: stats.frames,
    dropped: stats.dropped,
    ratio: ratioPercent,
    p95,
  });

  return (
    <Pressable style={styles.bar} onPress={onReset}>
      <View style={styles.row}>
        <Text style={styles.text} numberOfLines={1}>
          {text}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(20,19,23,0.85)',
    zIndex: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  text: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
  },
});
