import type { BottomTabBarProps } from 'expo-router/tabs';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../i18n';
import { tapHaptic } from './feedback';
import { TABS, useBottomChrome } from './layout';
import { colors, fontSizes, shadows, textScale } from './theme';

// NOTE: expo-blur blurs only on iOS, so Android gets a near-opaque frosted fill; upgrade path: wrap the
// tab navigator's scenes in a BlurTargetView and pass it as `blurTarget`.
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
    // The shadow lives on this non-clipping wrapper because `capsule` clips to round the glass. An
    // outset `boxShadow` draws only outside the box, so the wrapper needs no fill.
    <View style={[styles.shadowFrame, { bottom: tabBarBottom }]} pointerEvents="box-none">
      <View style={styles.capsule}>
        <Material />
        {/* NOTE: white at 0 alpha, not `transparent` (transparent BLACK, a grey blend); start/end aim at 115deg,
            but expo-linear-gradient applies them per axis, so a non-square capsule renders another angle. */}
        <LinearGradient
          colors={[colors.glass[65], colors.glass[0]]}
          start={{ x: 0.047, y: 0.289 }}
          end={{ x: 0.953, y: 0.711 }}
          locations={[0, 0.4]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={styles.row} accessibilityRole="tablist" testID="tab-list">
          {TABS.map((tab, index) => {
            const route = state.routes.at(index);
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
                tapHaptic('selection');
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
                <View
                  style={[styles.lens, { opacity: selected ? 1 : 0 }]}
                  pointerEvents="none"
                  testID={`tab-lens-${tab.route}`}
                />
                <View style={styles.tabContent}>
                  <Icon size={18} color={selected ? colors.accentText : colors.tabInactive} />
                  <Text
                    style={[styles.label, { color: selected ? colors.accentText : colors.tabInactive }]}
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
    boxShadow: shadows.tabBar,
  },
  capsule: {
    flex: 1,
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.glass[80],
  },
  blurOverlay: {
    backgroundColor: colors.glass[42],
  },
  opaqueFallback: {
    backgroundColor: colors.glass[85],
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 5,
  },
  // Android's 48 dp minimum touch target.
  tab: {
    flex: 1,
    height: 48,
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
    borderRadius: 24,
    backgroundColor: colors.glass[90],
    boxShadow: shadows.tabLens,
  },
  label: {
    fontSize: fontSizes.micro,
    fontWeight: '600',
  },
});
