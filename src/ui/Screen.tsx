import { LinearGradient } from 'expo-linear-gradient';
import type { ComponentProps } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AnchoredCta } from './AnchoredCta';
import { useBottomChrome } from './layout';
import { colors, gradients, spacing } from './theme';

export function Screen(props: {
  title: string;
  children: React.ReactNode;
  cta?: ComponentProps<typeof AnchoredCta>;
}): React.JSX.Element {
  const { title, children, cta } = props;
  const insets = useSafeAreaInsets();
  const { contentPaddingBottom } = useBottomChrome();

  return (
    <LinearGradient colors={gradients.background} style={styles.background}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.md, paddingBottom: contentPaddingBottom },
        ]}
      >
        <Text style={styles.title}>{title.toUpperCase()}</Text>
        {children}
      </ScrollView>
      {cta ? <AnchoredCta {...cta} /> : null}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
  },
  scroll: {
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
