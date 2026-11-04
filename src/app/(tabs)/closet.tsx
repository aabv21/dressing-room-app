import { Camera, ImageIcon } from 'lucide-react-native';
import { useMemo, useState } from 'react';

import { ClosetGrid } from '../../closet/ClosetGrid';
import { perfFixtureItems } from '../../closet/perfFixtureItems';
import { useI18n } from '../../i18n';
import { PERF_HUD_HEIGHT, PerfHud } from '../../perf/PerfHud';
import { useFrameStats } from '../../perf/useFrameStats';
import type { AnchoredCta } from '../../ui/AnchoredCta';
import { Screen, ScreenTitle, useScreenContentInsets } from '../../ui/Screen';

// NOTE: fixture mode is temporary, gated behind `EXPO_PUBLIC_PERF_FIXTURES_URL`, and goes away once
// real garments arrive from Supabase. The env var is set only for the on-device performance gate
// build and never carries a secret — it's just a LAN URL to the fixture server started by
// `pnpm perf:serve`. An empty value counts as unset.
function perfFixturesUrl(): string | undefined {
  const url = process.env.EXPO_PUBLIC_PERF_FIXTURES_URL;
  return url ? url : undefined;
}

const noop = (): void => undefined;

// Owns the frame stats so their ~500 ms updates re-render only the HUD, never the list it measures.
function LivePerfHud({ active }: { active: boolean }): React.JSX.Element {
  const { stats, reset } = useFrameStats(active);
  return <PerfHud stats={stats} onReset={reset} />;
}

function PerfFixtureCloset({ baseUrl }: { baseUrl: string }): React.JSX.Element {
  const { t } = useI18n();
  const insets = useScreenContentInsets();
  const items = useMemo(() => perfFixtureItems(baseUrl), [baseUrl]);
  const [scrolling, setScrolling] = useState(false);
  const title = t('screen.closet');
  const header = useMemo(() => <ScreenTitle title={title} />, [title]);
  const contentInset = useMemo(
    () => ({ top: insets.top + PERF_HUD_HEIGHT, bottom: insets.bottom }),
    [insets.top, insets.bottom],
  );

  // Mockup 02's anchored CTA, disabled until upload exists. It makes the gate screen
  // representative: the CTA's fade sits over the scrolling grid as it will in the real app.
  const cta = useMemo<React.ComponentProps<typeof AnchoredCta>>(
    () => ({
      secondary: { label: t('closet.gallery'), tone: 'ghost', icon: ImageIcon, onPress: noop, disabled: true },
      primary: { label: t('closet.burstMode'), tone: 'commit', icon: Camera, onPress: noop, disabled: true },
    }),
    [t],
  );

  return (
    <Screen scroll={false} cta={cta}>
      <ClosetGrid
        items={items}
        header={header}
        contentInset={contentInset}
        onScrollActiveChange={setScrolling}
      />
      <LivePerfHud active={scrolling} />
    </Screen>
  );
}

function EmptyCloset(): React.JSX.Element {
  const { t } = useI18n();
  const insets = useScreenContentInsets();
  return (
    <Screen scroll={false}>
      <ClosetGrid items={[]} header={<ScreenTitle title={t('screen.closet')} />} contentInset={insets} />
    </Screen>
  );
}

export default function ClosetScreen() {
  const baseUrl = perfFixturesUrl();
  return baseUrl ? <PerfFixtureCloset baseUrl={baseUrl} /> : <EmptyCloset />;
}
