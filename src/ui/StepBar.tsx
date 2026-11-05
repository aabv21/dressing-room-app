import { StyleSheet, View } from 'react-native';

import { useI18n } from '../i18n';
import { colors, radii } from './theme';

const TOTAL_STEPS = 3;
const STEPS = [1, 2, 3] as const;

/** Mockup 03's 3-segment onboarding progress bar (`.steps`). */
export function StepBar({ step }: { step: 1 | 2 | 3 }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('onboarding.step', { step, total: TOTAL_STEPS })}
      accessibilityValue={{ min: 1, max: TOTAL_STEPS, now: step }}
      testID="step-bar"
    >
      {STEPS.map((segment) => (
        <View
          key={segment}
          style={[styles.segment, segment <= step ? styles.segmentOn : null]}
          testID={segment <= step ? 'step-bar-segment-on' : 'step-bar-segment-off'}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: 'row',
    gap: 4,
    paddingVertical: 4,
  },
  segment: {
    flex: 1,
    height: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.track,
  },
  segmentOn: {
    backgroundColor: colors.accent,
  },
});
