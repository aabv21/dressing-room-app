import { LinearGradient } from 'expo-linear-gradient';
import type { ComponentProps } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AnchoredCta } from './AnchoredCta';
import { useBottomChrome } from './layout';
import { colors, gradients, spacing } from './theme';

type ScreenProps = { cta?: ComponentProps<typeof AnchoredCta> } & (
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
export function useScreenContentInsets(): { top: number; bottom: number } {
  const insets = useSafeAreaInsets();
  const { contentPaddingBottom } = useBottomChrome();
  return { top: insets.top + spacing.md, bottom: contentPaddingBottom };
}

export function ScreenTitle({ title }: { title: string }): React.JSX.Element {
  return (
    <Text style={styles.title} accessibilityRole="header">
      {title.toUpperCase()}
    </Text>
  );
}

export function Screen(props: ScreenProps): React.JSX.Element {
  const { cta } = props;
  const contentInsets = useScreenContentInsets();

  return (
    <LinearGradient colors={gradients.background} style={styles.fill}>
      {props.scroll === false ? (
        <View style={styles.fill}>{props.children}</View>
      ) : (
        <ScrollView
          style={styles.fill}
          contentContainerStyle={[
            styles.content,
            { paddingTop: contentInsets.top, paddingBottom: contentInsets.bottom },
          ]}
        >
          <ScreenTitle title={props.title} />
          {props.children}
        </ScrollView>
      )}
      {cta ? <AnchoredCta {...cta} /> : null}
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
});
