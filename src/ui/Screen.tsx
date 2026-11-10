import { LinearGradient } from 'expo-linear-gradient';
import type { ComponentProps } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AnchoredCta } from './AnchoredCta';
import { useBottomChrome } from './layout';
import type { ScreenChrome } from './layout';
import { colors, gradients, spacing, textScale } from './theme';

type ScreenProps = {
  cta?: ComponentProps<typeof AnchoredCta>;
  chrome?: ScreenChrome;
  /**
   * Rendered above the title (mockup 03 screen 1's `.top` row: the LanguageToggle sits top-right,
   * above the headline, not beside it at the same baseline). Only meaningful with `scroll !==
   * false`, since a non-scrolling screen renders its own header entirely.
   */
  headerAccessory?: React.ReactNode;
  /**
   * 'hero' is ~1.26x the default title size (about 21-22pt vs 17pt), weight 900, and does not
   * uppercase or strip line breaks — for `auth.welcome.title`'s forced two-line headline
   * ("DRESS\nWITHOUT DOUBT"). 'default' (unset) keeps the existing single-line uppercased title.
   */
  titleVariant?: 'default' | 'hero';
} & (
  | {
      /** Default: Screen scrolls its children and renders the title above them. */
      scroll?: true;
      title: string;
      children: React.ReactNode;
    }
  | {
      /**
       * For screens whose content is its own scroll container (a virtualized list). Children fill
       * the screen; they render `ScreenTitle` themselves (e.g. as the list header) and pad their
       * content with `useScreenContentInsets()`. Nesting a list inside the default ScrollView would
       * stretch it to its full height and defeat virtualization.
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
  return (
    <Text style={styles.title} accessibilityRole="header">
      {title.toUpperCase()}
    </Text>
  );
}

export function Screen(props: ScreenProps): React.JSX.Element {
  const { cta, chrome = 'tabs', headerAccessory, titleVariant = 'default' } = props;
  const contentInsets = useScreenContentInsets(chrome);

  return (
    <LinearGradient colors={gradients.background} style={styles.fill}>
      {props.scroll === false ? (
        <View style={styles.fill}>{props.children}</View>
      ) : (
        <ScrollView
          style={styles.fill}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.content,
            { paddingTop: contentInsets.top, paddingBottom: contentInsets.bottom },
          ]}
        >
          {headerAccessory ? <View style={styles.headerRow}>{headerAccessory}</View> : null}
          <ScreenTitle title={props.title} variant={titleVariant} />
          {props.children}
        </ScrollView>
      )}
      {cta ? <AnchoredCta {...cta} chrome={chrome} /> : null}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  title: {
    color: colors.ink,
    fontWeight: '900',
    fontSize: 17,
    letterSpacing: 1,
  },
  // ~1.26x the default 17pt title (the mockup's hero is about 21–22pt), same 900 weight; no uppercase (a
  // catalog-provided "\n" forces the mockup's two-line break instead of wrapping unpredictably).
  // `letterSpacing: 1.1` matches the mockup's `.ttl { letter-spacing: .05em }` at this 22pt size
  // (CSS `em` is relative to the element's own font-size: 22 * 0.05 = 1.1pt).
  heroTitle: {
    color: colors.ink,
    fontWeight: '900',
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: 1.1,
  },
  // No justifyContent here by design: callers control their own accessory's alignment (e.g.
  // welcome's language toggle sits flex-end; sign-in/forgot-password's back chevron sits
  // flex-start) by wrapping their content in a full-width row with the alignment they need.
  headerRow: {
    flexDirection: 'row',
  },
});
