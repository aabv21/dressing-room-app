import { StyleSheet, View } from 'react-native';

import { useBottomChrome } from './layout';
import { gradients } from './theme';

/**
 * On a `chrome="none"` screen the CTA zone ends `ctaBottom` above the bottom edge, so content would
 * show through that strip; this fills it. `Screen` renders it; a screen with its own layout renders it
 * just before the AnchoredCta.
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
