import { MapPin } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useI18n } from '../../i18n';
import type { Database } from '../../lib/database.types';
import { useOnboarding } from '../../profile/OnboardingProvider';
import type { Result } from '../../profile/profileRepository';
import { useCurrentCity } from '../../profile/useCurrentCity';
import { announceForAccessibility } from '../../ui/a11y';
import { ChipGroup } from '../../ui/ChipGroup';
import { Screen } from '../../ui/Screen';
import { StepBar } from '../../ui/StepBar';
import { TextField } from '../../ui/TextField';
import { colors, layout, spacing } from '../../ui/theme';

type Style = Database['public']['Enums']['style'];
type Occasion = Database['public']['Enums']['occasion'];

const STYLES: readonly Style[] = ['casual', 'elegant', 'minimalist', 'sporty', 'urban', 'bohemian', 'classic'];
const OCCASIONS: readonly Occasion[] = ['office', 'university', 'going_out', 'home', 'event', 'sport'];

type Coords = { lat: number; lon: number };

function StyleStep() {
  const { t } = useI18n();
  const { values, save, finish } = useOnboarding();
  const { request: requestCity } = useCurrentCity();
  const [styles, setStyles] = useState<Style[]>(values.styles ?? []);
  const [occasions, setOccasions] = useState<Occasion[]>(values.occasions ?? []);
  const [city, setCity] = useState(values.city_name ?? '');
  // Coordinates only travel with the name they were geocoded to; typing a different city drops them.
  const [coords, setCoords] = useState<Coords | null>(
    values.city_lat !== null && values.city_lat !== undefined && values.city_lon !== null && values.city_lon !== undefined
      ? { lat: values.city_lat, lon: values.city_lon }
      : null,
  );
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function handleUseLocation(): Promise<void> {
    setLocationMessage(undefined);
    setLocating(true);
    const result = await requestCity();
    setLocating(false);
    if (!result.ok) {
      const message = t(result.error === 'denied' ? 'onboarding.style.locationDenied' : 'onboarding.style.locationUnavailable');
      setLocationMessage(message);
      announceForAccessibility(message);
      return;
    }
    setCity(result.city.name);
    setCoords({ lat: result.city.lat, lon: result.city.lon });
  }

  async function submit(saveFirst: boolean): Promise<void> {
    setError(undefined);
    setSubmitting(true);
    let result: Result = { ok: true };
    if (saveFirst) {
      const cityName = city.trim();
      result = await save({
        styles,
        occasions,
        city_name: cityName === '' ? null : cityName,
        city_lat: cityName === '' ? null : (coords?.lat ?? null),
        city_lon: cityName === '' ? null : (coords?.lon ?? null),
      });
    }
    if (result.ok) {
      result = await finish();
    }
    setSubmitting(false);
    if (!result.ok) {
      setError(t(result.error));
      announceForAccessibility(t(result.error));
    }
  }

  return (
    <Screen
      title={t('onboarding.style.title')}
      chrome="none"
      headerAccessory={<StepBar step={3} />}
      cta={{
        secondary: {
          label: t('onboarding.skip'),
          tone: 'ghost',
          disabled: submitting,
          onPress: () => {
            void submit(false);
          },
        },
        primary: {
          label: t('onboarding.start'),
          tone: 'ai',
          disabled: submitting,
          onPress: () => {
            void submit(true);
          },
        },
      }}
    >
      <Text style={sheet.label}>{t('onboarding.style.styles')}</Text>
      <ChipGroup
        accessibilityLabel={t('onboarding.style.styles')}
        options={STYLES.map((value) => ({ value, label: t(`style.${value}`) }))}
        selected={styles}
        onChange={setStyles}
        testID="style-styles"
      />
      <Text style={[sheet.label, sheet.spaced]}>{t('onboarding.style.occasions')}</Text>
      <ChipGroup
        accessibilityLabel={t('onboarding.style.occasions')}
        options={OCCASIONS.map((value) => ({ value, label: t(`occasion.${value}`) }))}
        selected={occasions}
        onChange={setOccasions}
        testID="style-occasions"
      />
      <Text style={[sheet.label, sheet.spaced]}>{t('onboarding.style.city')}</Text>
      <TextField
        label={t('onboarding.style.city')}
        placeholder={t('onboarding.style.cityPlaceholder')}
        showLabel={false}
        value={city}
        onChangeText={(next) => {
          setCity(next);
          setCoords(null);
        }}
        autoCapitalize="words"
        autoComplete="postal-address-locality"
        textContentType="addressCity"
        maxLength={80}
        testID="style-city"
        leading={<MapPin size={16} color={colors.accentText} />}
        trailing={
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: locating, busy: locating }}
            disabled={locating}
            onPress={() => {
              void handleUseLocation();
            }}
            style={sheet.locationButton}
            hitSlop={{ top: 0, bottom: 0, left: 8, right: 8 }}
            testID="style-use-location"
          >
            <Text style={sheet.locationLabel}>
              {locating ? t('onboarding.style.locating') : t('onboarding.style.useLocation')}
            </Text>
          </Pressable>
        }
      />
      {locationMessage !== undefined ? (
        <Text style={sheet.hint} accessibilityLiveRegion="polite">
          {locationMessage}
        </Text>
      ) : null}
      {error !== undefined ? (
        <Text style={sheet.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}

export default function StyleRoute() {
  const { status } = useOnboarding();
  return status === 'ready' ? <StyleStep /> : null;
}

const sheet = StyleSheet.create({
  label: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  spaced: {
    marginTop: spacing.sm,
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
  hint: {
    color: colors.muted,
    fontSize: 13,
  },
  error: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '600',
  },
});
