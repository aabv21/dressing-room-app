import Slider from '@react-native-community/slider';
import { ChevronDown, ChevronUp, MapPin } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Locale, MessageKey } from '../i18n';
import { useI18n } from '../i18n';
import { announceForAccessibility } from '../ui/a11y';
import { ChipGroup } from '../ui/ChipGroup';
import { OptionCard } from '../ui/OptionCard';
import { Silhouette } from '../ui/Silhouette';
import { TextField } from '../ui/TextField';
import { colors, layout, selectionRing, spacing } from '../ui/theme';
import { silhouettesFor, suggestBodyType } from './bodyType';
import type { BodyAnswers, ClothingType } from './bodyType';
import { defaultHeightFor, withClothingType } from './profileDraft';
import type { AgeGroup, BodyErrors, Occasion, ProfileDraft, Style } from './profileDraft';
import { useCurrentCity } from './useCurrentCity';
import { SIZE_MAX_LENGTH } from './validation';
import type { BodyField, FieldError } from './validation';

/**
 * The profile's editable sections, shared by the onboarding steps (one section per step) and the
 * Profile tab (all three on one screen). Each one is controlled: it renders `value` and reports
 * edits through `onChange` as a partial draft; saving is the screen's job.
 */
type SectionProps = {
  value: ProfileDraft;
  onChange: (patch: Partial<ProfileDraft>) => void;
};

// ---------------------------------------------------------------------------------------------
// Clothing

const CLOTHING_OPTIONS: readonly { value: ClothingType; emoji: string; title: MessageKey; hint: MessageKey }[] = [
  { value: 'feminine', emoji: '👗', title: 'onboarding.clothing.feminine', hint: 'onboarding.clothing.feminineHint' },
  { value: 'masculine', emoji: '👔', title: 'onboarding.clothing.masculine', hint: 'onboarding.clothing.masculineHint' },
  { value: 'everything', emoji: '🧢', title: 'onboarding.clothing.everything', hint: 'onboarding.clothing.everythingHint' },
];

export function ClothingSection({ value, onChange }: SectionProps): React.JSX.Element {
  const { t } = useI18n();
  return (
    <View style={styles.options} accessibilityRole="radiogroup">
      {CLOTHING_OPTIONS.map((option) => (
        <OptionCard
          key={option.value}
          emoji={option.emoji}
          title={t(option.title)}
          subtitle={t(option.hint)}
          selected={value.clothingType === option.value}
          onPress={() => {
            onChange(withClothingType(value, option.value));
          }}
          testID={`clothing-${option.value}`}
        />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------------------------
// Body

// Global constraints: the slider runs 140–210 cm in steps of 1. Saved heights may be anywhere in
// the DB's 120–230 range, so one outside the slider keeps its true value in the label (and in what
// a screen reader says) while the thumb rests at the nearest end, with a note explaining why.
export const SLIDER_MIN = 140;
export const SLIDER_MAX = 210;
const AGE_GROUPS: readonly AgeGroup[] = ['under_18', '18_24', '25_34', '35_44', '45_54', '55_plus'];

type AnswerOption<T> = { value: T; label: MessageKey };

const SHOULDER_ANSWERS: readonly AnswerOption<BodyAnswers['shoulders']>[] = [
  { value: 'narrow', label: 'onboarding.body.answer.narrow' },
  { value: 'average', label: 'onboarding.body.answer.average' },
  { value: 'broad', label: 'onboarding.body.answer.broad' },
];
// Separate keys from the shoulder answers: Spanish adjectives agree with the noun ("hombros
// estrechos", "caderas estrechas").
const HIP_ANSWERS: readonly AnswerOption<BodyAnswers['hips']>[] = [
  { value: 'narrow', label: 'onboarding.body.answer.hipsNarrow' },
  { value: 'average', label: 'onboarding.body.answer.hipsAverage' },
  { value: 'wide', label: 'onboarding.body.answer.hipsWide' },
];
const WAIST_ANSWERS: readonly AnswerOption<BodyAnswers['waist']>[] = [
  { value: 'defined', label: 'onboarding.body.answer.defined' },
  { value: 'straight', label: 'onboarding.body.answer.straight' },
  { value: 'fuller', label: 'onboarding.body.answer.fuller' },
];

// A bitmap thumb (white disc, violet ring — mockup 03's `.track i`) so the slider looks the same on
// iOS and Android instead of each platform's native knob.
// The slider's typings only accept a `{ uri }` source (its runtime resolves either), so the asset is
// resolved here.
const thumbImage = Image.resolveAssetSource(
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro resolves image assets (and their @2x/@3x variants) only through require(); this repo has no `*.png` module declaration for an import.
  require('../../assets/images/slider-thumb.png') as number,
);

export function formatMeters(heightCm: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(heightCm / 100);
}

export function BodySection({
  value,
  onChange,
  errors = {},
  onFieldBlur,
}: SectionProps & {
  errors?: BodyErrors;
  /** Lets a screen show a field's error once the user leaves it, instead of on every keystroke. */
  onFieldBlur?: (field: BodyField) => void;
}): React.JSX.Element {
  const { t, locale } = useI18n();
  const clothing = value.clothingType ?? 'everything';
  const silhouettes = silhouettesFor(clothing);
  const heightCm = value.heightCm ?? defaultHeightFor(value.clothingType);
  const heightOutOfRange = heightCm < SLIDER_MIN || heightCm > SLIDER_MAX;

  // Open from the start when something optional is already saved, so it's visible.
  const [optionalOpen, setOptionalOpen] = useState(
    [value.chestCm, value.waistCm, value.hipsCm, value.topSize, value.bottomSize, value.shoeSize].some(
      (entry) => entry !== '',
    ) || value.ageGroup !== null,
  );
  const [helperOpen, setHelperOpen] = useState(false);
  const [answers, setAnswers] = useState<Partial<BodyAnswers>>({});
  // Every field except height lives in the collapsible section, so errors there keep it open.
  const optionalShown =
    optionalOpen ||
    [errors.chestCm, errors.waistCm, errors.hipsCm, errors.topSize, errors.bottomSize, errors.shoeSize].some(
      (error) => error !== undefined,
    );

  const suggestion = useMemo(() => {
    const { shoulders, hips, waist } = answers;
    if (shoulders === undefined || hips === undefined || waist === undefined) {
      return null;
    }
    return suggestBodyType({ shoulders, hips, waist }, clothing);
  }, [answers, clothing]);

  function answer(next: Partial<BodyAnswers>): void {
    const merged = { ...answers, ...next };
    setAnswers(merged);
    const { shoulders, hips, waist } = merged;
    if (shoulders !== undefined && hips !== undefined && waist !== undefined) {
      onChange({ bodyType: suggestBodyType({ shoulders, hips, waist }, clothing) });
    }
  }

  function message(error: FieldError | undefined): string | undefined {
    return error === undefined ? undefined : t(error.key, error.params);
  }

  const answerOptions = <T extends string>(options: readonly AnswerOption<T>[]) =>
    options.map((option) => ({ value: option.value, label: t(option.label) }));

  const meters = formatMeters(heightCm, locale);
  const outOfRangeNote = t('onboarding.body.heightOutOfRange', {
    min: formatMeters(SLIDER_MIN, locale),
    max: formatMeters(SLIDER_MAX, locale),
  });

  return (
    <View style={styles.section}>
      <View style={styles.grid} accessibilityRole="radiogroup">
        {silhouettes.map((type) => {
          const selected = value.bodyType === type;
          return (
            <Pressable
              key={type}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected }}
              accessibilityLabel={t(`bodyType.${type}`)}
              onPress={() => {
                onChange({ bodyType: selected ? null : type });
              }}
              style={[styles.cell, selected ? styles.cellOn : null]}
              testID={`body-${type}`}
            >
              <Silhouette type={type} selected={selected} />
              <Text style={[styles.cellLabel, selected ? styles.cellLabelOn : null]}>{t(`bodyType.${type}`)}</Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: helperOpen }}
          onPress={() => {
            setHelperOpen((open) => !open);
          }}
          style={styles.cell}
          testID="body-helper"
        >
          <Text style={styles.helperLabel}>{t('onboarding.body.helper')}</Text>
        </Pressable>
      </View>

      {helperOpen ? (
        <View style={styles.card} testID="body-helper-panel">
          <Text style={styles.question}>{t('onboarding.body.shoulders')}</Text>
          <ChipGroup
            multiple={false}
            accessibilityLabel={t('onboarding.body.shoulders')}
            options={answerOptions(SHOULDER_ANSWERS)}
            selected={answers.shoulders !== undefined ? [answers.shoulders] : []}
            onChange={([next]) => {
              if (next !== undefined) {
                answer({ shoulders: next });
              }
            }}
          />
          <Text style={styles.question}>{t('onboarding.body.hips')}</Text>
          <ChipGroup
            multiple={false}
            accessibilityLabel={t('onboarding.body.hips')}
            options={answerOptions(HIP_ANSWERS)}
            selected={answers.hips !== undefined ? [answers.hips] : []}
            onChange={([next]) => {
              if (next !== undefined) {
                answer({ hips: next });
              }
            }}
          />
          <Text style={styles.question}>{t('onboarding.body.waist')}</Text>
          <ChipGroup
            multiple={false}
            accessibilityLabel={t('onboarding.body.waist')}
            options={answerOptions(WAIST_ANSWERS)}
            selected={answers.waist !== undefined ? [answers.waist] : []}
            onChange={([next]) => {
              if (next !== undefined) {
                answer({ waist: next });
              }
            }}
          />
          {suggestion !== null ? (
            <Text style={styles.suggestion} accessibilityLiveRegion="polite">
              {t('onboarding.body.suggestion', { type: t(`bodyType.${suggestion}`) })}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.card}>
        <View style={styles.heightRow}>
          <Text style={styles.muted}>{t('onboarding.body.height')}</Text>
          <Text style={styles.heightValue} testID="body-height-value">
            {t('onboarding.body.heightValue', { meters })}
          </Text>
        </View>
        <Slider
          testID="body-height-slider"
          accessibilityLabel={t('onboarding.body.height')}
          // Spoken as the true height in metres. NOTE: not the slider's own accessibilityUnits /
          // accessibilityIncrements: in 5.2.1 Android parses each increment with Integer.parseInt
          // (a crash for "1.65") and iOS drops the plural for "1.x"; upgrade path: revisit if the
          // library accepts decimal increments.
          accessibilityValue={{
            min: SLIDER_MIN,
            max: SLIDER_MAX,
            now: Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, heightCm)),
            text: t('onboarding.body.heightSpoken', { meters }),
          }}
          {...(heightOutOfRange ? { accessibilityHint: outOfRangeNote } : {})}
          minimumValue={SLIDER_MIN}
          maximumValue={SLIDER_MAX}
          step={1}
          value={Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, heightCm))}
          onValueChange={(next) => {
            onChange({ heightCm: Math.round(next) });
          }}
          minimumTrackTintColor={colors.accent}
          maximumTrackTintColor={colors.track}
          {...(thumbImage !== undefined ? { thumbImage } : {})}
          style={styles.slider}
        />
        {heightOutOfRange ? (
          <Text style={styles.note} testID="body-height-note" importantForAccessibility="no" accessibilityElementsHidden>
            {outOfRangeNote}
          </Text>
        ) : null}
        {errors.heightCm !== undefined ? <Text style={styles.error}>{message(errors.heightCm)}</Text> : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: optionalShown }}
        onPress={() => {
          setOptionalOpen(!optionalShown);
        }}
        style={styles.accordion}
        testID="body-optional-toggle"
      >
        <Text style={styles.accordionLabel}>{t('onboarding.body.optional')}</Text>
        {optionalShown ? <ChevronUp size={18} color={colors.muted} /> : <ChevronDown size={18} color={colors.muted} />}
      </Pressable>

      {optionalShown ? (
        <View style={styles.section} testID="body-optional">
          <View style={styles.fieldRow}>
            <View style={styles.field}>
              <TextField
                label={t('onboarding.body.chest')}
                value={value.chestCm}
                onChangeText={(chestCm) => {
                  onChange({ chestCm });
                }}
                keyboardType="number-pad"
                maxLength={3}
                error={message(errors.chestCm)}
                onBlur={() => {
                  onFieldBlur?.('chestCm');
                }}
                testID="body-chest"
              />
            </View>
            <View style={styles.field}>
              <TextField
                label={t('onboarding.body.waistCm')}
                value={value.waistCm}
                onChangeText={(waistCm) => {
                  onChange({ waistCm });
                }}
                keyboardType="number-pad"
                maxLength={3}
                error={message(errors.waistCm)}
                onBlur={() => {
                  onFieldBlur?.('waistCm');
                }}
                testID="body-waist"
              />
            </View>
            <View style={styles.field}>
              <TextField
                label={t('onboarding.body.hipsCm')}
                value={value.hipsCm}
                onChangeText={(hipsCm) => {
                  onChange({ hipsCm });
                }}
                keyboardType="number-pad"
                maxLength={3}
                error={message(errors.hipsCm)}
                onBlur={() => {
                  onFieldBlur?.('hipsCm');
                }}
                testID="body-hips"
              />
            </View>
          </View>
          <View style={styles.fieldRow}>
            <View style={styles.field}>
              <TextField
                label={t('onboarding.body.topSize')}
                value={value.topSize}
                onChangeText={(topSize) => {
                  onChange({ topSize });
                }}
                autoCapitalize="characters"
                maxLength={SIZE_MAX_LENGTH + 2}
                error={message(errors.topSize)}
                onBlur={() => {
                  onFieldBlur?.('topSize');
                }}
                testID="body-top-size"
              />
            </View>
            <View style={styles.field}>
              <TextField
                label={t('onboarding.body.bottomSize')}
                value={value.bottomSize}
                onChangeText={(bottomSize) => {
                  onChange({ bottomSize });
                }}
                autoCapitalize="characters"
                maxLength={SIZE_MAX_LENGTH + 2}
                error={message(errors.bottomSize)}
                onBlur={() => {
                  onFieldBlur?.('bottomSize');
                }}
                testID="body-bottom-size"
              />
            </View>
            <View style={styles.field}>
              <TextField
                label={t('onboarding.body.shoeSize')}
                value={value.shoeSize}
                onChangeText={(shoeSize) => {
                  onChange({ shoeSize });
                }}
                autoCapitalize="characters"
                maxLength={SIZE_MAX_LENGTH + 2}
                error={message(errors.shoeSize)}
                onBlur={() => {
                  onFieldBlur?.('shoeSize');
                }}
                testID="body-shoe-size"
              />
            </View>
          </View>
          <Text style={styles.question}>{t('onboarding.body.age')}</Text>
          <ChipGroup
            multiple={false}
            accessibilityLabel={t('onboarding.body.age')}
            options={AGE_GROUPS.map((group) => ({ value: group, label: t(`ageGroup.${group}`) }))}
            selected={value.ageGroup !== null ? [value.ageGroup] : []}
            onChange={([next]) => {
              onChange({ ageGroup: next ?? null });
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------------------------
// Style

const STYLES: readonly Style[] = ['casual', 'elegant', 'minimalist', 'sporty', 'urban', 'bohemian', 'classic'];
const OCCASIONS: readonly Occasion[] = ['office', 'university', 'going_out', 'home', 'event', 'sport'];

export function StyleSection({ value, onChange }: SectionProps): React.JSX.Element {
  const { t } = useI18n();
  const { request: requestCity } = useCurrentCity();
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState<MessageKey | undefined>(undefined);
  // Counts the user's own edits to the city field. A location lookup that resolves after the user
  // typed (it can take seconds) must not overwrite what they typed.
  const cityEditsRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function handleUseLocation(): Promise<void> {
    setLocationMessage(undefined);
    setLocating(true);
    const editsAtStart = cityEditsRef.current;
    const result = await requestCity();
    if (!mountedRef.current) {
      return;
    }
    setLocating(false);
    if (cityEditsRef.current !== editsAtStart) {
      return;
    }
    if (!result.ok) {
      const key = result.error === 'denied' ? 'onboarding.style.locationDenied' : 'onboarding.style.locationUnavailable';
      setLocationMessage(key);
      announceForAccessibility(t(key));
      return;
    }
    onChange({ cityName: result.city.name, cityCoords: { lat: result.city.lat, lon: result.city.lon } });
  }

  return (
    <View style={styles.section}>
      <Text style={styles.question}>{t('onboarding.style.styles')}</Text>
      <ChipGroup
        accessibilityLabel={t('onboarding.style.styles')}
        options={STYLES.map((style) => ({ value: style, label: t(`style.${style}`) }))}
        selected={value.styles}
        onChange={(next) => {
          onChange({ styles: next });
        }}
        testID="style-styles"
      />
      <Text style={[styles.question, styles.spaced]}>{t('onboarding.style.occasions')}</Text>
      <ChipGroup
        accessibilityLabel={t('onboarding.style.occasions')}
        options={OCCASIONS.map((occasion) => ({ value: occasion, label: t(`occasion.${occasion}`) }))}
        selected={value.occasions}
        onChange={(next) => {
          onChange({ occasions: next });
        }}
        testID="style-occasions"
      />
      <Text style={[styles.question, styles.spaced]}>{t('onboarding.style.city')}</Text>
      <TextField
        label={t('onboarding.style.city')}
        placeholder={t('onboarding.style.cityPlaceholder')}
        showLabel={false}
        value={value.cityName}
        onChangeText={(cityName) => {
          cityEditsRef.current += 1;
          onChange({ cityName, cityCoords: null });
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
            style={styles.locationButton}
            hitSlop={{ top: 0, bottom: 0, left: 8, right: 8 }}
            testID="style-use-location"
          >
            <Text style={styles.locationLabel}>
              {locating ? t('onboarding.style.locating') : t('onboarding.style.useLocation')}
            </Text>
          </Pressable>
        }
      />
      {locationMessage !== undefined ? (
        <Text style={styles.muted} accessibilityLiveRegion="polite">
          {t(locationMessage)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.sm,
  },
  options: {
    gap: 10,
    marginTop: spacing.xs,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  cell: {
    flexBasis: '30%',
    flexGrow: 1,
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 4,
    paddingTop: 8,
    paddingBottom: 7,
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: colors.hairline,
    borderRadius: 14,
  },
  cellOn: {
    borderColor: colors.accent,
    boxShadow: selectionRing,
  },
  cellLabel: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 14,
    textAlign: 'center',
  },
  cellLabelOn: {
    color: colors.accentText,
  },
  helperLabel: {
    color: colors.accentText,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 15,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: spacing.sm,
  },
  question: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  spaced: {
    marginTop: spacing.sm,
  },
  suggestion: {
    color: colors.accentText,
    fontSize: 13,
    fontWeight: '700',
  },
  heightRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  muted: {
    color: colors.muted,
    fontSize: 13,
  },
  heightValue: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '800',
  },
  slider: {
    height: layout.minHitTarget,
  },
  note: {
    color: colors.muted,
    fontSize: 12,
  },
  accordion: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: layout.minHitTarget,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.dashed,
    borderRadius: 14,
  },
  accordionLabel: {
    flex: 1,
    color: colors.muted,
    fontSize: 13,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  field: {
    flex: 1,
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
  error: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '600',
  },
});
