// The city modal, opened from Today's weather line: the profile's city, "use my location" and Save.
// Closing it returns to Today, which refetches the list (and its weather) when it regains focus.
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Check, MapPin, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { useI18n, type MessageKey } from '../i18n';
import { cityToPatch, type CityPatch } from '../profile/profileDraft';
import { getProfile, saveProfile } from '../profile/profileRepository';
import { useCurrentCity } from '../profile/useCurrentCity';
import { announceForAccessibility } from '../ui/a11y';
import { AnchoredCta } from '../ui/AnchoredCta';
import { ScreenTitle, useScreenContentInsets } from '../ui/Screen';
import { TextField } from '../ui/TextField';
import { colors, gradients, layout, spacing } from '../ui/theme';

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; saved: CityPatch };

function close(): void {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace('/');
  }
}

function samePatch(a: CityPatch, b: CityPatch): boolean {
  return a.city_name === b.city_name && a.city_lat === b.city_lat && a.city_lon === b.city_lon;
}

export default function CityScreen(): React.JSX.Element {
  const { t } = useI18n();
  const { userId } = useAuth();
  const insets = useScreenContentInsets('none');
  const { request: requestCity } = useCurrentCity();

  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState('');
  // Coordinates only travel with the name they were geocoded to; typing a city drops them.
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ key: MessageKey; error: boolean } | undefined>(undefined);
  // Locks a second Save tap before the re-render that disables the button lands.
  const busy = useRef(false);
  // Counts the user's own edits: a location lookup that resolves after they typed doesn't overwrite it.
  const edits = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (userId === null) return undefined;
    let current = true;
    getProfile(userId).then(
      (profile) => {
        if (!current) return;
        const lat = profile?.city_lat ?? null;
        const lon = profile?.city_lon ?? null;
        const saved = cityToPatch(profile?.city_name ?? '', lat !== null && lon !== null ? { lat, lon } : null);
        setName(saved.city_name ?? '');
        setCoords(saved.city_lat !== null && saved.city_lon !== null ? { lat: saved.city_lat, lon: saved.city_lon } : null);
        setLoad({ status: 'ready', saved });
      },
      () => {
        if (current) setLoad({ status: 'error' });
      },
    );
    return () => {
      current = false;
    };
  }, [userId, attempt]);

  const locate = useCallback(async () => {
    setMessage(undefined);
    setLocating(true);
    const editsAtStart = edits.current;
    const result = await requestCity();
    if (!mounted.current) return;
    setLocating(false);
    if (edits.current !== editsAtStart) return;
    if (!result.ok) {
      const key = result.error === 'denied' ? 'onboarding.style.locationDenied' : 'onboarding.style.locationUnavailable';
      setMessage({ key, error: false });
      announceForAccessibility(t(key));
      return;
    }
    setName(result.city.name);
    setCoords({ lat: result.city.lat, lon: result.city.lon });
  }, [requestCity, t]);

  const save = useCallback(async () => {
    if (load.status !== 'ready' || userId === null || busy.current) return;
    const patch = cityToPatch(name, coords);
    if (samePatch(patch, load.saved)) {
      close();
      return;
    }
    busy.current = true;
    setMessage(undefined);
    setSaving(true);
    const result = await saveProfile(userId, patch);
    busy.current = false;
    if (!mounted.current) return;
    setSaving(false);
    if (!result.ok) {
      setMessage({ key: result.error, error: true });
      announceForAccessibility(t(result.error));
      return;
    }
    close();
  }, [load, userId, name, coords, t]);

  let body: React.ReactNode;
  let cta: React.ReactNode = null;
  if (load.status === 'loading') {
    body = <ActivityIndicator style={styles.spinner} color={colors.accent} accessibilityLabel={t('onboarding.loading')} />;
  } else if (load.status === 'error') {
    body = (
      <Text style={styles.text} accessibilityLiveRegion="polite">
        {t('onboarding.loadError')}
      </Text>
    );
    cta = (
      <AnchoredCta
        chrome="none"
        primary={{
          label: t('onboarding.retry'),
          tone: 'commit',
          onPress: () => {
            setLoad({ status: 'loading' });
            setAttempt((value) => value + 1);
          },
        }}
      />
    );
  } else {
    body = (
      <>
        <TextField
          label={t('onboarding.style.city')}
          placeholder={t('onboarding.style.cityPlaceholder')}
          showLabel={false}
          value={name}
          onChangeText={(next) => {
            edits.current += 1;
            setName(next);
            setCoords(null);
          }}
          autoCapitalize="words"
          autoComplete="postal-address-locality"
          textContentType="addressCity"
          maxLength={80}
          returnKeyType="done"
          onSubmitEditing={() => {
            void save();
          }}
          testID="city-name"
          leading={<MapPin size={16} color={colors.accentText} />}
          trailing={
            <Pressable
              accessibilityRole="button"
              // Not while a save is in flight: a location landing then would change the field under it.
              accessibilityState={{ disabled: locating || saving, busy: locating }}
              disabled={locating || saving}
              onPress={() => {
                void locate();
              }}
              style={styles.locationButton}
              hitSlop={{ left: 8, right: 8 }}
            >
              <Text style={styles.locationLabel}>
                {locating ? t('onboarding.style.locating') : t('onboarding.style.useLocation')}
              </Text>
            </Pressable>
          }
        />
        {message === undefined ? null : (
          <Text style={message.error ? styles.error : styles.message} accessibilityLiveRegion="polite">
            {t(message.key)}
          </Text>
        )}
      </>
    );
    cta = (
      <AnchoredCta
        chrome="none"
        primary={{
          label: t('city.save'),
          tone: 'commit',
          icon: Check,
          disabled: saving || locating,
          onPress: () => {
            void save();
          },
        }}
      />
    );
  }

  return (
    <LinearGradient colors={gradients.background} style={styles.fill}>
      <ScrollView
        style={styles.fill}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          // iOS shows the modal as a page sheet below the status bar; Android's modal is full screen.
          { paddingTop: Platform.OS === 'ios' ? spacing.lg : insets.top, paddingBottom: insets.bottom },
        ]}
      >
        <View style={styles.header}>
          <View style={styles.fill}>
            <ScreenTitle title={t('city.title')} />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('city.close')}
            onPress={close}
            style={styles.closeButton}
          >
            <X size={22} color={colors.ink} />
          </Pressable>
        </View>
        <Text style={styles.intro}>{t('city.intro')}</Text>
        {body}
      </ScrollView>
      {cta}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm + 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  closeButton: {
    width: layout.minHitTarget,
    height: layout.minHitTarget,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  intro: {
    color: colors.muted,
    fontSize: 14,
  },
  text: {
    color: colors.ink,
    fontSize: 15,
  },
  spinner: {
    marginVertical: spacing.lg,
  },
  locationButton: {
    minHeight: layout.minHitTarget,
    justifyContent: 'center',
  },
  locationLabel: {
    color: colors.accentText,
    fontSize: 13,
    fontWeight: '700',
  },
  message: {
    color: colors.muted,
    fontSize: 13,
  },
  error: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '600',
  },
});
