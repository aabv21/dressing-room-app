// Mockup 02 screen 2: the burst camera. A dark full-screen modal (registered as such in
// `_layout.tsx`, without the tab bar) where the user shoots one garment per photo with no forms,
// then hands every shot to the upload queue at once. The simulator has no camera, so this screen is exercised here
// through its permission/denied states and its own logic (shutter debounce, the running shot list,
// Close's confirmation) — the real capture flow is an owner-session check (see AGENTS.md).
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, usePreventRemove } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Check, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ShotStrip } from '../closet/ShotStrip';
import { useUploadQueue } from '../closet/UploadQueueProvider';
import { pluralKey, useI18n } from '../i18n';
import { AnchoredCta } from '../ui/AnchoredCta';
import { layout } from '../ui/theme';

const JPEG_QUALITY = 0.8;

function PermissionGate({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();

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

  /**
   * The Discard / Keep shooting choice, shared by the Close button and `usePreventRemove`'s
   * blocked-removal callback below. `proceed` already includes disabling prevention before it
   * navigates (`uris` is still non-empty at that instant, so skipping that would have the hook
   * re-block its own caller's navigation with a second, redundant confirmation).
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

  // A hardware back press, the system back gesture, or (on iOS) swiping the modal away all
  // bypass the Close button — `presentation: 'fullScreenModal'` falls back to a plain `modal` on
  // Android, whose back gesture/button would otherwise leave with unsaved shots and skip the
  // Discard confirmation entirely. `usePreventRemove` intercepts any such removal attempt while
  // shots are pending; its callback's `repeat()` continues that specific blocked action (already
  // preceded by the hook's own prevention-disabling, per its documented contract).
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
    } catch {
      // Hardware/session error, or the device ran out of storage: keep the shots already taken
      // and leave the shutter usable for the next attempt.
      Alert.alert(t('camera.captureFailed'));
    } finally {
      capturing.current = false;
    }
  }, [t]);

  const done = useCallback(() => {
    // Disables prevention first: `uris` is still non-empty at this instant, and without this the
    // hook would intercept this very `router.back()` and pop an unwanted Discard confirmation
    // right after a successful Done.
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
          <X size={20} color="#ffffff" />
        </Pressable>
        <Text style={styles.title}>{t('camera.title')}</Text>
      </View>

      <View style={styles.viewfinder}>
        <View style={styles.hint}>
          <Text style={styles.hintText}>{t('camera.hint')}</Text>
        </View>
        <CameraView ref={cameraRef} style={styles.cameraFill} facing="back" />
        <View style={[styles.corner, styles.cornerTopLeft]} />
        <View style={[styles.corner, styles.cornerTopRight]} />
        <View style={[styles.corner, styles.cornerBottomLeft]} />
        <View style={[styles.corner, styles.cornerBottomRight]} />
      </View>

      <View style={styles.shotsRow}>
        <ShotStrip uris={uris} />
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
          <Text style={styles.countText}>{countLabel}</Text>
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
    backgroundColor: '#0e0d12',
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
    color: '#ffffff',
    fontSize: 15,
    textAlign: 'center',
  },
  settingsButton: {
    minHeight: layout.ctaHeight,
    minWidth: 160,
    paddingHorizontal: 20,
    borderRadius: 999,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsLabel: {
    color: '#0e0d12',
    fontWeight: '700',
    fontSize: 14,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  closeButton: {
    width: layout.minHitTarget,
    height: layout.minHitTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -10,
  },
  title: {
    color: '#ffffff',
    fontWeight: '900',
    fontSize: 17,
    letterSpacing: 1,
  },
  viewfinder: {
    height: 330,
    borderRadius: 22,
    backgroundColor: '#cfc4b2',
    overflow: 'hidden',
  },
  cameraFill: {
    flex: 1,
  },
  corner: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderColor: '#ffffff',
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
    backgroundColor: 'rgba(0,0,0,0.55)',
    color: '#ffffff',
    fontSize: 12,
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
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterDisc: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#ffffff',
  },
  countPill: {
    backgroundColor: '#8b5cf6',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  countText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 12,
  },
  caption: {
    color: '#bdbac6',
    fontSize: 13,
    textAlign: 'center',
  },
});
