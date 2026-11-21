import { StyleSheet, Text, View } from 'react-native';

import { useLargeText } from '../layout';
import { colors, fontSizes, radii, spacing } from '../theme';

/** Two to a row; above `LARGE_TEXT_FONT_SCALE` a tile takes the whole row so words don't break mid-word. */
export function KpiTile(props: { value: string; label: string }): React.JSX.Element {
  const { value, label } = props;
  const largeText = useLargeText();
  return (
    // One element for a screen reader: "62% of your closet worn this month".
    <View
      style={[styles.tile, largeText ? styles.fullRow : null]}
      accessible
      accessibilityLabel={`${value} ${label}`}
    >
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: colors.glass[85],
    borderWidth: 1,
    borderColor: colors.surface,
    borderRadius: radii.cell + 2,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
  },
  fullRow: {
    flexBasis: '100%',
  },
  value: {
    fontSize: fontSizes.headline,
    fontWeight: '900',
    lineHeight: 22,
    color: colors.ink,
  },
  label: {
    fontSize: fontSizes.caption,
    color: colors.muted,
    marginTop: 2,
  },
});
