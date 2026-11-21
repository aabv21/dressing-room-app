import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useLocalePreference } from '../i18n/I18nProvider';
import type { Locale } from '../i18n';
import { useI18n } from '../i18n';
import { colors, fontSizes, layout, radii } from './theme';

const SEGMENTS: readonly Locale[] = ['es', 'en'];

const MIN_HIT_TARGET = layout.minHitTarget;

/**
 * ES/EN: sets an explicit preference over the device locale (Profile adds "Use device language").
 * `onChange` fires only when the preference actually changes, e.g. so Profile can save it.
 */
export function LanguageToggle(props: { onChange?: (locale: Locale) => void } = {}): React.JSX.Element {
  const { onChange } = props;
  const { locale, t } = useI18n();
  const { preference, setPreference } = useLocalePreference();

  return (
    <View style={styles.track} accessibilityRole="tablist">
      {SEGMENTS.map((segment) => {
        const selected = locale === segment;
        const visibleLabel = segment === 'es' ? t('auth.language.es') : t('auth.language.en');
        const fullLabel = segment === 'es' ? t('auth.language.labelEs') : t('auth.language.labelEn');
        return (
          <Pressable
            key={segment}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={fullLabel}
            onPress={() => {
              if (preference === segment) {
                return;
              }
              setPreference(segment);
              onChange?.(segment);
            }}
            style={[styles.segment, selected ? styles.segmentOn : null]}
            hitSlop={6}
          >
            <Text style={[styles.label, selected ? styles.labelOn : null]}>{visibleLabel}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.pill,
    padding: 2,
  },
  segment: {
    paddingHorizontal: 12,
    minHeight: MIN_HIT_TARGET - 4, // the 2px track padding on top/bottom brings the tap area to 44
    minWidth: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
  },
  segmentOn: {
    backgroundColor: colors.commit,
  },
  label: {
    fontSize: fontSizes.micro,
    fontWeight: '700',
    color: colors.muted,
  },
  labelOn: {
    color: colors.onFill,
  },
});
