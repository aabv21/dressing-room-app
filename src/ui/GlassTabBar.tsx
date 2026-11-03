import type { BottomTabBarProps } from 'expo-router/tabs';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../i18n';
import { TABS, useBottomChrome } from './layout';

function Material(): React.JSX.Element {
  if (isLiquidGlassAvailable()) {
    return <GlassView glassEffectStyle="regular" style={StyleSheet.absoluteFill} />;
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <BlurView tint="light" intensity={40} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, styles.blurOverlay]} />
    </View>
  );
}

export function GlassTabBar(props: BottomTabBarProps): React.JSX.Element {
  const { state, emitter, navigateToTab } = props;
  const { t } = useI18n();
  const { tabBarBottom } = useBottomChrome();

  return (
    <View style={[styles.capsule, { bottom: tabBarBottom }]}>
      <Material />
      {/* NOTE: the end color is white at 0 alpha, not the `transparent` keyword — that keyword is
          transparent BLACK, which would make the gradient interpolate through visible grey.
          start/end are CSS `linear-gradient(115deg, ...)` converted to expo-linear-gradient's
          fractional points via start = (0.5 - sin(115deg)/2, 0.5 + cos(115deg)/2), end = the
          mirror of that, matching mockup 01's `.tabs::before` sheen angle exactly. */}
      <LinearGradient
        colors={['rgba(255,255,255,0.65)', 'rgba(255,255,255,0)']}
        start={{ x: 0.047, y: 0.289 }}
        end={{ x: 0.953, y: 0.711 }}
        locations={[0, 0.4]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={styles.row}>
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
              onPress={onPress}
              style={[styles.tab, selected ? styles.tabActive : null]}
            >
              <Icon size={18} color={selected ? '#6d28d9' : '#5f5b6b'} />
              <Text
                style={[styles.label, { color: selected ? '#6d28d9' : '#5f5b6b' }]}
                maxFontSizeMultiplier={1.3}
                numberOfLines={1}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  capsule: {
    position: 'absolute',
    left: 10,
    right: 10,
    height: 56,
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.8)',
    shadowColor: 'rgba(50,20,110,0.18)',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 1,
    shadowRadius: 28,
    elevation: 12,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  blurOverlay: {
    backgroundColor: 'rgba(255,255,255,0.42)',
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
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  tabActive: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    shadowColor: 'rgba(80,40,160,0.16)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
  },
});
