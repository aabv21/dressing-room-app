// The burst camera: one garment per photo, no forms, every shot handed to the upload queue at once.
// The simulator has no camera, so real capture is an owner check (docs/owner-runbook.md).
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, usePreventRemove } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Check, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, Animated, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ShotStrip } from '../closet/ShotStrip';
import { useGalleryImport } from '../closet/useGalleryImport';
import { useUploadQueue } from '../closet/UploadQueueProvider';
import { pluralKey, useI18n } from '../i18n';
import { AnchoredCta } from '../ui/AnchoredCta';
import { tapHaptic } from '../ui/feedback';
import { colors, fontSizes, layout } from '../ui/theme';

const JPEG_QUALITY = 0.8;

function PermissionGate({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const { pickFromGallery } = useGalleryImport();

  useEffect(() => {
    if (permission !== null && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  if (permission === null || (!permission.granted && permission.canAskAgain)) {
    // Undetermined (or mid-request): nothing to show yet — the effect above asks right away.
    return <View style={styles.fill} />;
  }

  if (!permission.granted) {
    return (
      <View style={[styles.fill, styles.centered, { paddingBottom: insets.bottom + 24 }]}>
        {/* A full-screen modal can't be swiped away on iOS, so the denied state needs its own exit. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('camera.permission.close')}
          onPress={() => {
            router.back();
          }}
          style={[styles.closeButton, styles.deniedClose, { top: insets.top + 12 }]}
        >
          <X size={20} color={colors.onFill} />
        </Pressable>
        <Text style={styles.deniedText}>{t('camera.permission.denied')}</Text>
        <Pressable
          accessibilityRole="button"
          style={styles.settingsButton}
          onPress={() => {
            void Linking.openSettings();
          }}
        >
          <Text style={styles.settingsLabel}>{t('camera.permission.openSettings')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={styles.galleryButton}
          onPress={() => {
            void pickFromGallery().then((picked) => {
              if (picked) router.back();
            });
          }}
        >
          <Text style={styles.galleryLabel}>{t('camera.permission.gallery')}</Text>
        </Pressable>
      </View>
    );
  }

  return <>{children}</>;
}

function BurstCamera(): React.JSX.Element {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { enqueue } = useUploadQueue();
  const cameraRef = useRef<CameraView>(null);
  const [uris, setUris] = useState<readonly string[]>([]);
  const capturing = useRef(false);
  const [flash] = useState(() => new Animated.Value(0));
  const reduceMotion = useRef(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      reduceMotion.current = enabled;
    });
  }, []);

  /**
   * Discard / Keep shooting, for Close and `usePreventRemove`'s callback. `proceed` must disable
   * prevention first: `uris` is still non-empty, so the hook would re-block with a second confirm.
   */
  const confirmDiscard = useCallback(
    (proceed: () => void) => {
      Alert.alert(t('camera.discard.title'), t('camera.discard.message'), [
        { text: t('camera.discard.keepShooting'), style: 'cancel' },
        { text: t('camera.discard.discard'), style: 'destructive', onPress: proceed },
      ]);
    },
    [t],
  );

  // Back press, back gesture or a swipe bypass Close (Android turns `fullScreenModal` into a plain
  // `modal`), so `usePreventRemove` blocks removal while shots are pending; `repeat()` resumes the
  // blocked action (the hook disables prevention first, per its contract).
  const disablePrevention = usePreventRemove(uris.length > 0, ({ repeat }) => {
    confirmDiscard(repeat);
  });

  const close = useCallback(() => {
    if (uris.length === 0) {
      router.back();
      return;
    }
    confirmDiscard(() => {
      disablePrevention();
      router.back();
    });
  }, [uris.length, confirmDiscard, disablePrevention]);

  const shoot = useCallback(async () => {
    if (capturing.current || cameraRef.current === null) {
      return;
    }
    capturing.current = true;
    try {
      const picture = await cameraRef.current.takePictureAsync({ quality: JPEG_QUALITY });
      setUris((current) => [...current, picture.uri]);
      tapHaptic('commit');
      if (!reduceMotion.current) {
        flash.setValue(0.6);
        Animated.timing(flash, { toValue: 0, duration: 150, useNativeDriver: true }).start();
      }
    } catch {
      // Hardware/session error or full storage: keep the shots taken and the shutter usable.
      Alert.alert(t('camera.captureFailed'));
    } finally {
      capturing.current = false;
    }
  }, [t, flash]);

  const done = useCallback(() => {
    // `uris` is still non-empty, so the hook would otherwise block this `router.back()` with a Discard prompt.
    disablePrevention();
    enqueue(uris);
    router.back();
  }, [enqueue, uris, disablePrevention]);

  const count = uris.length;
  const countLabel = t(pluralKey('camera.count', count), { count });

  const cta = {
    primary: {
      label: t('camera.done', { count }),
      tone: 'ai' as const,
      icon: Check,
      disabled: count === 0,
      onPress: done,
    },
  };

  return (
    <View style={[styles.fill, { paddingTop: insets.top + 12 }]}>
      <View style={styles.titleRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('camera.close')} onPress={close} style={styles.closeButton}>
          <X size={20} color={colors.onFill} />
        </Pressable>
        <Text style={styles.title}>{t('camera.title')}</Text>
      </View>

      <View style={styles.viewfinder}>
        <View style={styles.hint}>
          <Text style={styles.hintText}>{t('camera.hint')}</Text>
        </View>
        <CameraView ref={cameraRef} style={styles.cameraFill} facing="back" />
        <Animated.View pointerEvents="none" style={[styles.flash, { opacity: flash }]} testID="camera-flash" />
        <View style={[styles.corner, styles.cornerTopLeft]} />
        <View style={[styles.corner, styles.cornerTopRight]} />
        <View style={[styles.corner, styles.cornerBottomLeft]} />
        <View style={[styles.corner, styles.cornerBottomRight]} />
      </View>

      <View style={styles.shotsRow}>
        <ShotStrip
          uris={uris}
          onRemoveLast={() => {
            setUris((current) => current.slice(0, -1));
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('camera.shutter')}
          testID="camera-shutter"
          onPress={() => {
            void shoot();
          }}
          style={styles.shutterRing}
        >
          <View style={styles.shutterDisc} />
        </Pressable>
        <View style={styles.countPill}>
          <Text style={styles.countText} accessibilityLiveRegion="polite">
            {countLabel}
          </Text>
        </View>
      </View>

      <Text style={styles.caption}>{t('camera.caption')}</Text>

      <AnchoredCta {...cta} chrome="none" surface="dark" />
    </View>
  );
}

export default function CameraScreen(): React.JSX.Element {
  return (
    <View style={styles.screen}>
      {/* The camera is dark: light icons while it's open. */}
      <StatusBar style="light" />
      <PermissionGate>
        <BurstCamera />
      </PermissionGate>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.night,
  },
  fill: {
    flex: 1,
    paddingHorizontal: 14,
    gap: 9,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 24,
  },
  deniedText: {
    color: colors.onFill,
    fontSize: fontSizes.body,
    textAlign: 'center',
  },
  settingsButton: {
    minHeight: layout.ctaHeight,
    minWidth: 160,
    paddingHorizontal: 20,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsLabel: {
    color: colors.night,
    fontWeight: '700',
    fontSize: fontSizes.body,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deniedClose: {
    position: 'absolute',
    left: 20,
    marginLeft: 0,
  },
  galleryButton: {
    minHeight: layout.minHitTarget,
    marginTop: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryLabel: {
    color: colors.onFill,
    fontWeight: '700',
    fontSize: fontSizes.body,
  },
  flash: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.surface,
  },
  closeButton: {
    width: layout.minHitTarget,
    height: layout.minHitTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -10,
  },
  title: {
    color: colors.onFill,
    fontWeight: '900',
    fontSize: fontSizes.title,
    letterSpacing: 1,
  },
  viewfinder: {
    height: 330,
    borderRadius: 22,
    backgroundColor: colors.viewfinder,
    overflow: 'hidden',
  },
  cameraFill: {
    flex: 1,
  },
  corner: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderColor: colors.onFill,
    borderWidth: 3,
  },
  cornerTopLeft: {
    top: 16,
    left: 16,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderTopLeftRadius: 8,
  },
  cornerTopRight: {
    top: 16,
    right: 16,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
    borderTopRightRadius: 8,
  },
  cornerBottomLeft: {
    bottom: 16,
    left: 16,
    borderRightWidth: 0,
    borderTopWidth: 0,
    borderBottomLeftRadius: 8,
  },
  cornerBottomRight: {
    bottom: 16,
    right: 16,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderBottomRightRadius: 8,
  },
  hint: {
    position: 'absolute',
    top: 12,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1,
  },
  hintText: {
    backgroundColor: colors.scrimDark,
    color: colors.onFill,
    fontSize: fontSizes.caption,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  shotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  shutterRing: {
    width: 66,
    height: 66,
    borderRadius: 33,
    borderWidth: 4,
    borderColor: colors.onFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterDisc: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.onFill,
  },
  countPill: {
    backgroundColor: colors.accentBright,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  countText: {
    color: colors.onFill,
    fontWeight: '800',
    fontSize: fontSizes.caption,
  },
  caption: {
    color: colors.mutedOnDark,
    fontSize: fontSizes.bodySmall,
    textAlign: 'center',
  },
});
