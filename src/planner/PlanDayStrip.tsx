// Days as a horizontal strip of day chips (a radio group), a dot under each planned day: the planner's
// 14 days, and a trip's start day.
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../i18n';
import { androidRipple, pressedStyle, tapHaptic } from '../ui/feedback';
import { colors, fontSizes, layout, radii, spacing } from '../ui/theme';
import { formatPlanDay } from './planCache';

export function PlanDayStrip({
  days,
  selected,
  planned,
  onSelect,
  label,
}: {
  days: readonly string[];
  selected: string;
  planned: ReadonlySet<string>;
  onSelect: (day: string) => void;
  /** The group's name for screen readers; the planner's by default. */
  label?: string;
}): React.JSX.Element {
  const { t, locale } = useI18n();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroller}
      contentContainerStyle={styles.content}
      accessibilityRole="radiogroup"
      accessibilityLabel={label ?? t('plan.days')}
      testID="plan-days"
    >
      {days.map((day) => {
        const date = new Date(`${day}T12:00:00`);
        const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date);
        const isSelected = day === selected;
        const isPlanned = planned.has(day);
        const label = formatPlanDay(locale, day);
        return (
          <Pressable
            key={day}
            accessibilityRole="radio"
            accessibilityLabel={isPlanned ? t('plan.day.planned', { day: label }) : label}
            accessibilityState={{ selected: isSelected }}
            onPress={() => {
              tapHaptic('selection');
              onSelect(day);
            }}
            android_ripple={androidRipple}
            style={({ pressed }) => [styles.day, isSelected ? styles.selected : null, pressed && Platform.OS === 'ios' && pressedStyle]}
          >
            <Text style={[styles.weekday, isSelected ? styles.onSelected : null]}>{weekday}</Text>
            <Text style={[styles.number, isSelected ? styles.onSelected : null]}>{String(date.getDate())}</Text>
            <View style={[styles.dot, isPlanned ? (isSelected ? styles.dotOnSelected : styles.dotOn) : null]} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // Bleeds to the screen edges so the days scroll out under them, like Today's occasion chips.
  scroller: {
    marginHorizontal: -spacing.md,
    flexGrow: 0,
  },
  content: {
    gap: 6,
    paddingHorizontal: spacing.md,
  },
  day: {
    minWidth: layout.minHitTarget + 4,
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.cell,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  selected: {
    backgroundColor: colors.selected,
    borderColor: colors.selected,
  },
  weekday: {
    color: colors.muted,
    fontSize: fontSizes.caption,
  },
  number: {
    color: colors.ink,
    fontSize: fontSizes.title,
    fontWeight: '700',
  },
  onSelected: {
    color: colors.onFill,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  dotOn: {
    backgroundColor: colors.accent,
  },
  dotOnSelected: {
    backgroundColor: colors.onFill,
  },
});
