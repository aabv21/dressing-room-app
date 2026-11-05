import Slider from '@react-native-community/slider';
import { router } from 'expo-router';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Locale, MessageKey } from '../../i18n';
import { useI18n } from '../../i18n';
import type { Database } from '../../lib/database.types';
import { silhouettesFor, suggestBodyType } from '../../profile/bodyType';
import type { BodyAnswers, BodyType } from '../../profile/bodyType';
import { useOnboarding } from '../../profile/OnboardingProvider';
import type { BodyField, FieldError } from '../../profile/validation';
import { SIZE_MAX_LENGTH, validateBody } from '../../profile/validation';
import { announceForAccessibility } from '../../ui/a11y';
import { ChipGroup } from '../../ui/ChipGroup';
import { Screen } from '../../ui/Screen';
import { Silhouette } from '../../ui/Silhouette';
import { StepBar } from '../../ui/StepBar';
import { TextField } from '../../ui/TextField';
import { colors, layout, selectionRing, spacing } from '../../ui/theme';

type AgeGroup = Database['public']['Enums']['age_group'];

// Global constraints: the slider runs 140–210 cm in steps of 1, defaulting to 165 (feminine,
// everything) or 175 (masculine) when no height is saved yet.
const SLIDER_MIN = 140;
const SLIDER_MAX = 210;
const AGE_GROUPS: readonly AgeGroup[] = ['under_18', '18_24', '25_34', '35_44', '45_54', '55_plus'];

type AnswerOption<T> = { value: T; label: MessageKey };

const SHOULDER_ANSWERS: readonly AnswerOption<BodyAnswers['shoulders']>[] = [
  { value: 'narrow', label: 'onboarding.body.answer.narrow' },
  { value: 'average', label: 'onboarding.body.answer.average' },
  { value: 'broad', label: 'onboarding.body.answer.broad' },
];
const HIP_ANSWERS: readonly AnswerOption<BodyAnswers['hips']>[] = [
  { value: 'narrow', label: 'onboarding.body.answer.narrow' },
  { value: 'average', label: 'onboarding.body.answer.average' },
  { value: 'wide', label: 'onboarding.body.answer.wide' },
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
  require('../../../assets/images/slider-thumb.png') as number,
);

function formatMeters(heightCm: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(heightCm / 100);
}

function toText(value: string | number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

function BodyStep() {
  const { t, locale } = useI18n();
  const { values, save } = useOnboarding();
  const clothing = values.clothing_type ?? 'everything';
  const silhouettes = silhouettesFor(clothing);

  const [bodyType, setBodyType] = useState<BodyType | null>(
    values.body_type !== null && values.body_type !== undefined && silhouettes.includes(values.body_type)
      ? values.body_type
      : null,
  );
  const [heightCm, setHeightCm] = useState(values.height_cm ?? (clothing === 'masculine' ? 175 : 165));
  const [chestCm, setChestCm] = useState(toText(values.chest_cm));
  const [waistCm, setWaistCm] = useState(toText(values.waist_cm));
  const [hipsCm, setHipsCm] = useState(toText(values.hips_cm));
  const [topSize, setTopSize] = useState(toText(values.top_size));
  const [bottomSize, setBottomSize] = useState(toText(values.bottom_size));
  const [shoeSize, setShoeSize] = useState(toText(values.shoe_size));
  const [ageGroup, setAgeGroup] = useState<AgeGroup | null>(values.age_group ?? null);
  // Open from the start when something optional is already saved, so a relaunch shows it.
  const [optionalOpen, setOptionalOpen] = useState(
    [chestCm, waistCm, hipsCm, topSize, bottomSize, shoeSize].some((entry) => entry !== '') || ageGroup !== null,
  );
  const [helperOpen, setHelperOpen] = useState(false);
  const [answers, setAnswers] = useState<Partial<BodyAnswers>>({});
  const [errors, setErrors] = useState<Partial<Record<BodyField, FieldError>>>({});
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

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
      setBodyType(suggestBodyType({ shoulders, hips, waist }, clothing));
    }
  }

  function message(error: FieldError | undefined): string | undefined {
    return error === undefined ? undefined : t(error.key, error.params);
  }

  async function handleNext(): Promise<void> {
    setSaveError(undefined);
    const validation = validateBody({ heightCm, chestCm, waistCm, hipsCm, topSize, bottomSize, shoeSize });
    if (!validation.ok) {
      setErrors(validation.errors);
      // Every field except height lives in the collapsible section: open it so the errors show.
      if (Object.keys(validation.errors).some((field) => field !== 'heightCm')) {
        setOptionalOpen(true);
      }
      const first = Object.values(validation.errors)[0];
      if (first !== undefined) {
        announceForAccessibility(t(first.key, first.params));
      }
      return;
    }
    setErrors({});
    setSaving(true);
    // A silhouette left unselected is omitted, not written as null, so a saved one is never lost.
    const result = await save({
      ...validation.patch,
      age_group: ageGroup,
      ...(bodyType !== null ? { body_type: bodyType } : {}),
    });
    setSaving(false);
    if (!result.ok) {
      setSaveError(t(result.error));
      announceForAccessibility(t(result.error));
      return;
    }
    router.push('/style');
  }

  const answerOptions = <T extends string>(options: readonly AnswerOption<T>[]) =>
    options.map((option) => ({ value: option.value, label: t(option.label) }));

  return (
    <Screen
      title={t('onboarding.body.title')}
      chrome="none"
      headerAccessory={<StepBar step={2} />}
      cta={{
        secondary: {
          label: t('onboarding.skip'),
          tone: 'ghost',
          disabled: saving,
          onPress: () => {
            router.push('/style');
          },
        },
        primary: {
          label: t('onboarding.next'),
          tone: 'commit',
          disabled: saving,
          onPress: () => {
            void handleNext();
          },
        },
      }}
    >
      <View style={styles.grid} accessibilityRole="radiogroup">
        {silhouettes.map((type) => {
          const selected = bodyType === type;
          return (
            <Pressable
              key={type}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected }}
              accessibilityLabel={t(`bodyType.${type}`)}
              onPress={() => {
                setBodyType(selected ? null : type);
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
            {t('onboarding.body.heightValue', { meters: formatMeters(heightCm, locale) })}
          </Text>
        </View>
        <Slider
          testID="body-height-slider"
          accessibilityLabel={t('onboarding.body.height')}
          minimumValue={SLIDER_MIN}
          maximumValue={SLIDER_MAX}
          step={1}
          value={Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, heightCm))}
          onValueChange={(next) => {
            setHeightCm(Math.round(next));
          }}
          minimumTrackTintColor={colors.accent}
          maximumTrackTintColor={colors.track}
          {...(thumbImage !== undefined ? { thumbImage } : {})}
          style={styles.slider}
        />
        {errors.heightCm !== undefined ? <Text style={styles.error}>{message(errors.heightCm)}</Text> : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: optionalOpen }}
        onPress={() => {
          setOptionalOpen((open) => !open);
        }}
        style={styles.accordion}
        testID="body-optional-toggle"
      >
        <Text style={styles.accordionLabel}>{t('onboarding.body.optional')}</Text>
        {optionalOpen ? <ChevronUp size={18} color={colors.muted} /> : <ChevronDown size={18} color={colors.muted} />}
      </Pressable>

      {optionalOpen ? (
        <View style={styles.optional} testID="body-optional">
          <View style={styles.fieldRow}>
            <View style={styles.field}>
              <TextField
                label={t('onboarding.body.chest')}
                value={chestCm}
                onChangeText={setChestCm}
                keyboardType="number-pad"
                maxLength={3}
                error={message(errors.chestCm)}
                testID="body-chest"
              />
            </View>
            <View style={styles.field}>
              <TextField
                label={t('onboarding.body.waistCm')}
                value={waistCm}
                onChangeText={setWaistCm}
                keyboardType="number-pad"
                maxLength={3}
                error={message(errors.waistCm)}
                testID="body-waist"
              />
            </View>
            <View style={styles.field}>
              <TextField
                label={t('onboarding.body.hipsCm')}
                value={hipsCm}
                onChangeText={setHipsCm}
                keyboardType="number-pad"
                maxLength={3}
                error={message(errors.hipsCm)}
                testID="body-hips"
              />
            </View>
          </View>
          <View style={styles.fieldRow}>
            <View style={styles.field}>
              <TextField
                label={t('onboarding.body.topSize')}
                value={topSize}
                onChangeText={setTopSize}
                autoCapitalize="characters"
                maxLength={SIZE_MAX_LENGTH + 2}
                error={message(errors.topSize)}
                testID="body-top-size"
              />
            </View>
            <View style={styles.field}>
              <TextField
                label={t('onboarding.body.bottomSize')}
                value={bottomSize}
                onChangeText={setBottomSize}
                autoCapitalize="characters"
                maxLength={SIZE_MAX_LENGTH + 2}
                error={message(errors.bottomSize)}
                testID="body-bottom-size"
              />
            </View>
            <View style={styles.field}>
              <TextField
                label={t('onboarding.body.shoeSize')}
                value={shoeSize}
                onChangeText={setShoeSize}
                autoCapitalize="characters"
                maxLength={SIZE_MAX_LENGTH + 2}
                error={message(errors.shoeSize)}
                testID="body-shoe-size"
              />
            </View>
          </View>
          <Text style={styles.question}>{t('onboarding.body.age')}</Text>
          <ChipGroup
            multiple={false}
            accessibilityLabel={t('onboarding.body.age')}
            options={AGE_GROUPS.map((value) => ({ value, label: t(`ageGroup.${value}`) }))}
            selected={ageGroup !== null ? [ageGroup] : []}
            onChange={([next]) => {
              setAgeGroup(next ?? null);
            }}
          />
        </View>
      ) : null}

      {saveError !== undefined ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {saveError}
        </Text>
      ) : null}
    </Screen>
  );
}

export default function BodyRoute() {
  const { status } = useOnboarding();
  return status === 'ready' ? <BodyStep /> : null;
}

const styles = StyleSheet.create({
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
  optional: {
    gap: spacing.sm,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  field: {
    flex: 1,
  },
  error: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '600',
  },
});
