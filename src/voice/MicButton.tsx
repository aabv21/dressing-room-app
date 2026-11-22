// A round mic button for `useDictation`: nothing when the phone has no speech recognition.
import { Mic, Square } from 'lucide-react-native';
import { Pressable, StyleSheet } from 'react-native';

import { useI18n } from '../i18n';
import { colors, layout, radii } from '../ui/theme';
import type { useDictation } from './dictation';

export function MicButton({
  dictation,
  label,
  size = 36,
}: {
  dictation: ReturnType<typeof useDictation>;
  label: string;
  size?: number;
}): React.JSX.Element | null {
  const { t } = useI18n();
  if (!dictation.available) return null;
  const slop = Math.max(0, (layout.minHitTarget - size) / 2);
  const Icon = dictation.listening ? Square : Mic;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={dictation.listening ? t('dictate.stop') : label}
      accessibilityState={{ busy: dictation.listening }}
      onPress={dictation.toggle}
      hitSlop={slop}
      style={[styles.button, { width: size, height: size }, dictation.listening ? styles.listening : null]}
    >
      <Icon size={Math.round(size * 0.45)} color={dictation.listening ? colors.onFill : colors.accentText} />
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
  listening: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
});
