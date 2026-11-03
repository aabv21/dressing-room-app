import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ClosetGrid } from '../../closet/ClosetGrid';
import { perfFixtureItems } from '../../closet/perfFixtureItems';
import { useI18n } from '../../i18n';
import { PerfHud } from '../../perf/PerfHud';
import { useFrameStats } from '../../perf/useFrameStats';
import { Screen } from '../../ui/Screen';

// NOTE: fixture mode is temporary, gated behind `EXPO_PUBLIC_PERF_FIXTURES_URL`, and goes away in
// Plan 3 once real garments arrive from Supabase. The env var is set only for the on-device
// performance gate build (Task 7) and never carries a secret — it's just a LAN URL to the local
// fixture server started by `pnpm perf:serve`.
const PERF_FIXTURES_URL = process.env.EXPO_PUBLIC_PERF_FIXTURES_URL;

function PerfFixtureGrid({ baseUrl }: { baseUrl: string }): React.JSX.Element {
  // `useFrameStats` publishes new stats ~every 500ms while scrolling, which re-renders this
  // component. Without memoizing, `perfFixtureItems` would rebuild a fresh 500-item array on
  // every one of those re-renders and hand FlashList a brand-new `data` identity each time.
  const items = useMemo(() => perfFixtureItems(baseUrl), [baseUrl]);
  const [scrolling, setScrolling] = useState(false);
  const { stats, reset } = useFrameStats(scrolling);

  return (
    <View style={styles.fill}>
      <ClosetGrid items={items} onScrollActiveChange={setScrolling} />
      <PerfHud stats={stats} onReset={reset} />
    </View>
  );
}

export default function ClosetScreen() {
  const { t } = useI18n();

  return (
    <Screen title={t('screen.closet')}>
      {PERF_FIXTURES_URL !== undefined ? (
        <PerfFixtureGrid baseUrl={PERF_FIXTURES_URL} />
      ) : (
        <ClosetGrid items={[]} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
