import { LinearGradient } from 'expo-linear-gradient';
import type { LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useBottomChrome } from './layout';
import type { ScreenChrome } from './layout';
import { colors, gradients, layout, radii, textScale } from './theme';

export type CtaTone = 'ai' | 'commit' | 'ghost';

export type CtaAction = {
  label: string;
  onPress: () => void;
  tone: CtaTone;
  icon?: LucideIcon;
  disabled?: boolean;
};

function ActionButton({ action, flexBasisPercent }: { action: CtaAction; flexBasisPercent?: number }) {
  const { label, onPress, tone, icon: Icon, disabled = false } = action;
  const textStyle = tone === 'ghost' ? styles.labelDark : styles.labelLight;
  const iconColor = tone === 'ghost' ? colors.ink : '#ffffff';

  const content = (
    <View style={styles.contentRow}>
      {Icon ? <Icon size={16} color={iconColor} style={styles.icon} /> : null}
      <Text style={textStyle} numberOfLines={2} maxFontSizeMultiplier={textScale.cta}>
        {label}
      </Text>
    </View>
  );

  const flexStyle =
    flexBasisPercent !== undefined
      ? { flexBasis: `${String(flexBasisPercent)}%`, flexGrow: 0 }
      : styles.flexFill;

  if (tone === 'ai') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={[styles.button, flexStyle, disabled ? styles.disabled : null]}
      >
        <LinearGradient colors={gradients.ai} style={styles.fill}>
          {content}
        </LinearGradient>
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        flexStyle,
        tone === 'commit' ? styles.commitFill : styles.ghostFill,
        disabled ? styles.disabled : null,
      ]}
    >
      {content}
    </Pressable>
  );
}

export function AnchoredCta(props: {
  primary: CtaAction;
  secondary?: CtaAction;
  chrome?: ScreenChrome;
  /** The screen under the zone: `dark` fades to near-black (the camera), as in mockup 02. */
  surface?: 'light' | 'dark';
  /** Shown just above the buttons, inside the anchored zone, so it's always on screen (e.g. a save error). */
  notice?: React.ReactNode;
}): React.JSX.Element {
  const { primary, secondary, chrome = 'tabs', surface = 'light', notice } = props;
  const { ctaBottom } = useBottomChrome(chrome);

  return (
    <View style={[styles.zone, { bottom: ctaBottom }]} pointerEvents="box-none">
      {/* NOTE: 'rgba(235,227,255,0)', not the `transparent` keyword — `transparent` is
          transparent BLACK, which would make this interpolate through visible grey. Solid from
          45% down, as in the mockups' `linear-gradient(to top, #ebe3ff 55%, transparent)`, so
          content scrolling under the buttons doesn't show through them. */}
      <LinearGradient
        colors={surface === 'dark' ? ['rgba(14,13,18,0)', '#0e0d12'] : ['rgba(235,227,255,0)', '#ebe3ff']}
        locations={[0, 0.45]}
        testID="cta-fade"
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {notice === undefined ? null : <View style={styles.notice}>{notice}</View>}
      <View style={styles.row}>
        {secondary ? <ActionButton action={secondary} flexBasisPercent={36} /> : null}
        <ActionButton action={primary} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  zone: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: 14,
    paddingTop: 22,
    paddingBottom: layout.ctaZoneBottomPadding,
  },
  notice: {
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  flexFill: {
    flex: 1,
  },
  button: {
    minHeight: layout.ctaHeight,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  fill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  commitFill: {
    backgroundColor: colors.commit,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  ghostFill: {
    backgroundColor: 'rgba(255,255,255,0.75)',
    borderWidth: 1,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  disabled: {
    opacity: 0.5,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  icon: {
    flexShrink: 0,
  },
  labelLight: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  labelDark: {
    color: colors.ink,
    fontWeight: '700',
    fontSize: 14,
  },
});
