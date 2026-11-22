// A round "Listen" / "Stop" button that reads `text` aloud (by itself once with `autoPlay`); nothing
// when the phone has no voice in the app language.
import { Square, Volume2 } from 'lucide-react-native';
import { Pressable, StyleSheet } from 'react-native';

import { useI18n } from '../i18n';
import { colors, layout, radii, spacing } from '../ui/theme';
import { useSpeaker } from './speech';

export function ListenButton({
  text,
  size = 28,
  autoPlay = false,
}: {
  text: string;
  size?: number;
  autoPlay?: boolean;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const speaker = useSpeaker(text, { autoPlay });
  if (speaker.hidden) return null;
  const slop = Math.max(0, (layout.minHitTarget - size) / 2);
  const Icon = speaker.speaking ? Square : Volume2;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={speaker.speaking ? t('listen.stop') : t('listen.action')}
      accessibilityHint={speaker.speaking ? undefined : t('listen.hint')}
      onPress={speaker.toggle}
      // Toward a neighboring chip the slop stays small, so the two never share a tap.
      hitSlop={{ top: slop, bottom: slop, left: spacing.xs, right: spacing.xs }}
      style={[styles.button, { minWidth: size, minHeight: size }, speaker.speaking ? styles.speaking : null]}
    >
      <Icon size={Math.round(size * 0.46)} color={speaker.speaking ? colors.onFill : colors.accentText} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    borderRadius: radii.pill,
  },
  speaking: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
});
