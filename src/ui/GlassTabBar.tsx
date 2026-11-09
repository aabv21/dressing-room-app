import type { BottomTabBarProps } from 'expo-router/tabs';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../i18n';
import { TABS, useBottomChrome } from './layout';
import { textScale } from './theme';

// NOTE: expo-blur only blurs on iOS out of the box; Android needs the blurred content wrapped in a
// BlurTargetView, which isn't wired yet. Until then Android gets a near-opaque frosted fill.
// Upgrade path: wrap the tab navigator's scenes in BlurTargetView and pass it as `blurTarget`.
const blurAvailable = Platform.OS === 'ios';

function Material(): React.JSX.Element {
  if (isLiquidGlassAvailable()) {
    return <GlassView glassEffectStyle="regular" style={StyleSheet.absoluteFill} />;
  }

  if (blurAvailable) {
    return (
      <View style={StyleSheet.absoluteFill}>
        <BlurView tint="light" intensity={40} style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.blurOverlay]} />
      </View>
    );
  }

  return <View style={[StyleSheet.absoluteFill, styles.opaqueFallback]} />;
}

export function GlassTabBar(props: BottomTabBarProps): React.JSX.Element {
  const { state, emitter, navigateToTab } = props;
  const { t } = useI18n();
  const { tabBarBottom } = useBottomChrome();

  return (
    // The drop shadow lives on this transparent, non-clipping wrapper: `capsule` must clip
    // (`overflow: 'hidden'`) to round the glass, which would also clip its own shadow. `boxShadow`
    // has CSS outset semantics (drawn only outside the box), so the wrapper needs no fill and the
    // content behind the capsule stays visible through the glass.
    <View style={[styles.shadowFrame, { bottom: tabBarBottom }]} pointerEvents="box-none">
      <View style={styles.capsule}>
        <Material />
        {/* NOTE: the end color is white at 0 alpha, not the `transparent` keyword — that keyword
            is transparent BLACK, which would make the gradient interpolate through visible grey.
            start/end approximate mockup 01's `.tabs::before` `linear-gradient(115deg, ...)`: they
            are (0.5 - sin(115deg)/2, 0.5 + cos(115deg)/2) and its mirror, but expo-linear-gradient
            applies those fractions per axis, so on a non-square capsule the rendered angle differs
            from 115deg. */}
        <LinearGradient
          colors={['rgba(255,255,255,0.65)', 'rgba(255,255,255,0)']}
          start={{ x: 0.047, y: 0.289 }}
          end={{ x: 0.953, y: 0.711 }}
          locations={[0, 0.4]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={styles.row} accessibilityRole="tablist" testID="tab-list">
          {TABS.map((tab, index) => {
            const route = state.routes[index];
            if (!route) {
              return null;
            }
            const selected = state.index === index;
            const label = t(tab.labelKey);
            const Icon = tab.icon;

            const onPress = () => {
              const event = emitter.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!selected && !event.defaultPrevented) {
                navigateToTab(route.key);
              }
            };

            return (
              <Pressable
                key={tab.route}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={label}
                // The label's size is capped to fit the bar; a long press shows it enlarged (iOS).
                accessibilityShowsLargeContentViewer
                accessibilityLargeContentTitle={label}
                onPress={onPress}
                style={styles.tab}
              >
                {/* The lens is always mounted and only fades in: Android draws a background or
                    shadow added on selection without the border radius. */}
                <View style={[styles.lens, { opacity: selected ? 1 : 0 }]} pointerEvents="none" />
                <View style={styles.tabContent}>
                  <Icon size={18} color={selected ? '#6d28d9' : '#5f5b6b'} />
                  <Text
                    style={[styles.label, { color: selected ? '#6d28d9' : '#5f5b6b' }]}
                    maxFontSizeMultiplier={textScale.compact}
                    numberOfLines={1}
                  >
                    {label}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shadowFrame: {
    position: 'absolute',
    left: 10,
    right: 10,
    height: 56,
    borderRadius: 30,
    boxShadow: '0px 12px 28px rgba(50,20,110,0.18)',
  },
  capsule: {
    flex: 1,
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.8)',
  },
  blurOverlay: {
    backgroundColor: 'rgba(255,255,255,0.42)',
  },
  opaqueFallback: {
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 5,
  },
  tab: {
    flex: 1,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  tabContent: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  // The lens doesn't clip, so its outset shadow can sit on the view itself without an opaque fill.
  lens: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.9)',
    boxShadow: '0px 2px 8px rgba(80,40,160,0.16), inset 0px 1px 0px #ffffff',
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
  },
});
