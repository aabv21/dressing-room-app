import { LinearGradient } from 'expo-linear-gradient';
import type { LucideIcon } from 'lucide-react-native';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { androidRipple, pressedStyle, tapHaptic } from './feedback';
import { useBottomChrome } from './layout';
import type { ScreenChrome } from './layout';
import { colors, fontSizes, gradients, layout, radii, textScale } from './theme';

export type CtaTone = 'ai' | 'commit' | 'ghost';

export type CtaAction = {
  label: string;
  onPress: () => void;
  tone: CtaTone;
  icon?: LucideIcon;
  disabled?: boolean;
};

function ActionButton({ action, flexBasisPercent }: { action: CtaAction; flexBasisPercent?: number }) {
  const { label, tone, icon: Icon, disabled = false } = action;
  const onPress = (): void => {
    tapHaptic(tone === 'ghost' ? 'selection' : 'commit');
    action.onPress();
  };
  const pressed = (state: { pressed: boolean }) => state.pressed && Platform.OS === 'ios' && pressedStyle;
  const textStyle = tone === 'ghost' ? styles.labelDark : styles.labelLight;
  const iconColor = tone === 'ghost' ? colors.ink : colors.onFill;

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
        // In the foreground: the gradient child would cover a background ripple.
        android_ripple={{ ...androidRipple, foreground: true }}
        style={(state) => [styles.button, flexStyle, disabled ? styles.disabled : null, pressed(state)]}
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
      android_ripple={androidRipple}
      style={(state) => [
        styles.button,
        flexStyle,
        tone === 'commit' ? styles.commitFill : styles.ghostFill,
        disabled ? styles.disabled : null,
        pressed(state),
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
  /** The screen under the zone: `dark` fades to near-black (the camera). */
  surface?: 'light' | 'dark';
  /** Shown just above the buttons, inside the anchored zone, so it's always on screen (e.g. a save error). */
  notice?: React.ReactNode;
}): React.JSX.Element {
  const { primary, secondary, chrome = 'tabs', surface = 'light', notice } = props;
  const { ctaBottom } = useBottomChrome(chrome);

  return (
    <View style={[styles.zone, { bottom: ctaBottom }]} pointerEvents="box-none">
      {/* NOTE: 0-alpha colors, not `transparent` (transparent BLACK, a grey blend); solid from 45% down
          (dark: 40%) so content scrolling under the buttons doesn't show through. */}
      <LinearGradient
        colors={surface === 'dark' ? [colors.nightClear, colors.night] : [colors.fadeClear, gradients.background[2]]}
        locations={surface === 'dark' ? [0, 0.4] : [0, 0.45]}
        testID="cta-fade"
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* The solid part of the fade takes the touches that land between or beside the buttons, so
          a tap there never reaches the hidden content scrolled underneath. */}
      <View
        testID="cta-touch-guard"
        style={[styles.touchGuard, { top: surface === 'dark' ? '40%' : '45%' }]}
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
    paddingTop: layout.ctaZoneTopPadding,
    paddingBottom: layout.ctaZoneBottomPadding,
  },
  touchGuard: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
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
    backgroundColor: colors.glass[75],
    borderWidth: 1,
    borderColor: colors.surface,
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
    color: colors.onFill,
    fontWeight: '700',
    fontSize: fontSizes.body,
  },
  labelDark: {
    color: colors.ink,
    fontWeight: '700',
    fontSize: fontSizes.body,
  },
});
