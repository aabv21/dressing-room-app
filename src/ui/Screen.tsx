import { LinearGradient } from 'expo-linear-gradient';
import type { ComponentProps } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AnchoredCta } from './AnchoredCta';
import { CtaBackdrop } from './CtaBackdrop';
import { useBottomChrome } from './layout';
import type { ScreenChrome } from './layout';
import { colors, fontSizes, gradients, spacing, textScale } from './theme';

type ScreenProps = {
  cta?: ComponentProps<typeof AnchoredCta>;
  chrome?: ScreenChrome;
  /** Rendered above the title (e.g. Welcome's LanguageToggle); a `scroll: false` screen renders its own header. */
  headerAccessory?: React.ReactNode;
  /** 'hero': larger, not uppercased, keeps line breaks (Welcome's two-line "DRESS\nWITHOUT DOUBT"). */
  titleVariant?: 'default' | 'hero';
} & (
  | {
      scroll?: true;
      title: string;
      children: React.ReactNode;
    }
  | {
      /**
       * Content that is its own scroll container (a virtualized list, which a ScrollView would defeat).
       * Children render `ScreenTitle` themselves and pad with `useScreenContentInsets()`.
       */
      scroll: false;
      children: React.ReactNode;
    }
);

/** Top/bottom content padding that clears the status bar, the anchored CTA and the tab bar. */
export function useScreenContentInsets(chrome: ScreenChrome = 'tabs'): { top: number; bottom: number } {
  const insets = useSafeAreaInsets();
  const { contentPaddingBottom } = useBottomChrome(chrome);
  return { top: insets.top + spacing.md, bottom: contentPaddingBottom };
}

export function ScreenTitle({
  title,
  variant = 'default',
}: {
  title: string;
  variant?: 'default' | 'hero';
}): React.JSX.Element {
  if (variant === 'hero') {
    return (
      <Text style={styles.heroTitle} accessibilityRole="header" maxFontSizeMultiplier={textScale.hero}>
        {title}
      </Text>
    );
  }
  // Shown upper-cased, read as written: VoiceOver can spell a short all-caps word letter by letter.
  return (
    <Text style={styles.title} accessibilityRole="header" accessibilityLabel={title}>
      {title.toUpperCase()}
    </Text>
  );
}

export function Screen(props: ScreenProps): React.JSX.Element {
  const { cta, chrome = 'tabs', headerAccessory, titleVariant = 'default' } = props;
  const contentInsets = useScreenContentInsets(chrome);
  const { top: statusBar } = useSafeAreaInsets();

  return (
    <LinearGradient colors={gradients.background} style={styles.fill}>
      {props.scroll === false ? (
        <View style={styles.fill}>{props.children}</View>
      ) : (
        // Android draws edge to edge, so the window no longer resizes for the keyboard: the padding
        // behavior shrinks the scroll view instead. iOS insets the scroll view itself (below).
        <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'android' ? 'padding' : undefined}>
          <ScrollView
            style={styles.fill}
            testID="screen-scroll"
            keyboardShouldPersistTaps="handled"
            // The fields below the focused one stay reachable above the keyboard, and a drag dismisses
            // it: a number pad has no return key.
            automaticallyAdjustKeyboardInsets
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            contentContainerStyle={[
              styles.content,
              { paddingTop: contentInsets.top, paddingBottom: contentInsets.bottom },
            ]}
          >
            {headerAccessory ? <View style={styles.headerRow}>{headerAccessory}</View> : null}
            <ScreenTitle title={props.title} variant={titleVariant} />
            {props.children}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
      {props.scroll === false ? null : (
        // Scrolled content fades out under the status bar instead of running into its icons.
        <LinearGradient
          colors={[gradients.background[0], colors.glass[0]]}
          style={[styles.scrim, { height: statusBar }]}
          pointerEvents="none"
          testID="status-scrim"
        />
      )}
      {cta && chrome === 'none' ? <CtaBackdrop /> : null}
      {cta ? <AnchoredCta {...cta} chrome={chrome} /> : null}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  content: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  title: {
    color: colors.ink,
    fontWeight: '900',
    fontSize: fontSizes.title,
    letterSpacing: 1,
  },
  // No uppercase: the catalog's "\n" forces the two-line break. `letterSpacing` is 0.05em at 22pt.
  heroTitle: {
    color: colors.ink,
    fontWeight: '900',
    fontSize: fontSizes.headline,
    lineHeight: 26,
    letterSpacing: 1.1,
  },
  // No justifyContent: callers align their accessory (Welcome's toggle flex-end, a back chevron
  // flex-start) with a full-width row of their own.
  headerRow: {
    flexDirection: 'row',
  },
});
