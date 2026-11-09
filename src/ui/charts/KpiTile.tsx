import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing } from '../theme';

/** Mockup 04's `.kpi` tile: a big value over a small muted label. */
export function KpiTile(props: { value: string; label: string }): React.JSX.Element {
  const { value, label } = props;
  return (
    // One element for a screen reader: "62% of your closet worn this month".
    <View style={styles.tile} accessible accessibilityLabel={`${value} ${label}`}>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderWidth: 1,
    borderColor: '#ffffff',
    borderRadius: radii.cell + 2,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
  },
  value: {
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 22,
    color: colors.ink,
  },
  label: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
});
