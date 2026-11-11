import { StyleSheet, View } from 'react-native';

import { useBottomChrome } from './layout';
import { gradients } from './theme';

/**
 * Mockup 02's `.cta.nobar` fade reaches the screen's bottom edge. On a `chrome="none"` screen,
 * AnchoredCta's zone ends `ctaBottom` above it, so content scrolling under the buttons would show
 * through that strip; this fills it with the background's last color. `Screen` renders it for a
 * `chrome="none"` screen with a CTA; a screen with its own layout renders it just before the
 * AnchoredCta.
 */
export function CtaBackdrop(): React.JSX.Element {
  const { ctaBottom } = useBottomChrome('none');
  // It takes touches too: the strip it covers sits under the buttons, never over content to tap.
  return <View style={[styles.backdrop, { height: ctaBottom }]} testID="cta-backdrop" />;
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
