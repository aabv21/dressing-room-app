import { StyleSheet, View } from 'react-native';

import { useBottomChrome } from './layout';
import { gradients } from './theme';

/**
 * Mockup 02's `.cta.nobar` fade reaches the screen's bottom edge. On a `chrome="none"` screen,
 * AnchoredCta's zone ends `ctaBottom` above it, so content scrolling under the buttons would show
 * through that strip; this fills it with the background's last color. Render it just before the
 * AnchoredCta.
 */
export function CtaBackdrop(): React.JSX.Element {
  const { ctaBottom } = useBottomChrome('none');
  return <View style={[styles.backdrop, { height: ctaBottom }]} pointerEvents="none" />;
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: gradients.background[2],
  },
});
