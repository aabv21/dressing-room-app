import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { useI18n, type MessageKey } from '../i18n';
import { colors, gradients, radii, spacing } from '../ui/theme';
import type { FirstOutfitProgress } from './closetSelectors';

const STEPS = 3;

/** The empty closet's goal: the first outfit (top, bottom and shoes, or a one-piece and shoes), with a three-step bar. */
export function GoalCard({ progress }: { progress: FirstOutfitProgress }): React.JSX.Element {
  const { t } = useI18n();
  const bodyDone = progress.onePiece || (progress.top && progress.bottom);
  const topDone = progress.top || progress.onePiece;
  const bottomDone = progress.bottom || progress.onePiece;
  const done = Number(topDone) + Number(bottomDone) + Number(progress.shoes);
  const text = t('closet.goal.progress', { count: done, goal: STEPS });
  const step = (key: MessageKey, isDone: boolean): React.JSX.Element => (
    <Text
      key={key}
      style={[styles.step, isDone ? styles.stepDone : null]}
      accessibilityLabel={`${t(key)}, ${t(isDone ? 'closet.goal.done' : 'closet.goal.todo')}`}
    >
      {isDone ? '✓ ' : ''}
      {t(key)}
    </Text>
  );
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.title}>{t('closet.goal.title')}</Text>
        <Text style={styles.muted}>{text}</Text>
      </View>
      <View
        style={styles.track}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={t('closet.goal.title')}
        accessibilityValue={{ min: 0, max: STEPS, now: done, text }}
      >
        <LinearGradient
          colors={gradients.ai}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.fill, { width: `${String((done / STEPS) * 100)}%` }]}
        />
      </View>
      <View style={styles.steps}>
        {step('closet.goal.top', topDone)}
        {step('closet.goal.bottom', bottomDone)}
        {bodyDone ? null : <Text style={styles.muted}>{t('closet.goal.onePiece')}</Text>}
        {step('closet.goal.shoes', progress.shoes)}
      </View>
      <Text style={styles.muted}>{t('closet.goal.body')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  steps: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: spacing.sm,
    rowGap: spacing.xs,
  },
  step: {
    color: colors.muted,
    fontSize: 14,
  },
  stepDone: {
    color: colors.accentText,
    fontWeight: '700',
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderWidth: 1,
    borderColor: '#ffffff',
    borderRadius: 18,
    padding: 14,
    gap: 9,
    boxShadow: '0px 6px 18px rgba(60,30,120,0.08)',
  },
  // Wraps the progress under the title when a large text size leaves no room for both.
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    columnGap: spacing.sm,
  },
  title: {
    flexShrink: 1,
    color: colors.ink,
    fontSize: 15,
    fontWeight: '700',
  },
  muted: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  track: {
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.track,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radii.pill,
  },
});
