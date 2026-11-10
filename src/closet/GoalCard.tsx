import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../i18n';
import { colors, gradients, radii, spacing } from '../ui/theme';

export const CLOSET_GOAL = 10;

/** Mockup 02 screen 1's goal card: the first 10 garments, with a progress bar. */
export function GoalCard({ count }: { count: number }): React.JSX.Element {
  const { t } = useI18n();
  const reached = Math.min(count, CLOSET_GOAL);
  const progress = t('closet.goal.progress', { count: reached, goal: CLOSET_GOAL });

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.title}>{t('closet.goal.title')}</Text>
        <Text style={styles.muted}>{progress}</Text>
      </View>
      <View
        style={styles.track}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={t('closet.goal.title')}
        accessibilityValue={{ min: 0, max: CLOSET_GOAL, now: reached, text: progress }}
      >
        <LinearGradient
          colors={gradients.ai}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.fill, { width: `${String((reached / CLOSET_GOAL) * 100)}%` }]}
        />
      </View>
      <Text style={styles.muted}>{t('closet.goal.body')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
