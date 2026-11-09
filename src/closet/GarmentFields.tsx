import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n, type MessageKey } from '../i18n';
import { ChipGroup, type ChipOption } from '../ui/ChipGroup';
import { colors, layout } from '../ui/theme';
import {
  categoriesFor,
  GARMENT_CATEGORIES,
  GARMENT_COLORS,
  GARMENT_FITS,
  GARMENT_MATERIALS,
  GARMENT_PATTERNS,
  OCCASIONS,
  PALETTE_HEX,
  SEASONS,
  slotOf,
  type ClothingType,
  type GarmentColor,
  type GarmentField,
  type Season,
} from './catalog';
import type { Garment } from './garmentRepository';

/** The garment attributes review and the garment detail edit. */
export type FieldValues = Pick<
  Garment,
  'category' | 'colors' | 'pattern' | 'material' | 'formality' | 'seasons' | 'warmth' | 'fit' | 'occasions'
>;

/** The editable attributes of a stored garment. */
export function fieldValuesOf(g: Garment): FieldValues {
  const { category, colors: garmentColors, pattern, material, formality, seasons, warmth, fit, occasions } = g;
  return { category, colors: garmentColors, pattern, material, formality, seasons, warmth, fit, occasions };
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  // Order counts: the first color is the dominant one.
  return a.length === b.length && a.every((entry, index) => entry === b.at(index));
}

/** Only the fields of `next` that differ from `stored`: the patch a save sends. */
export function changedFields(stored: FieldValues, next: FieldValues): Partial<FieldValues> {
  const patch: Partial<FieldValues> = {};
  if (next.category !== stored.category) {
    patch.category = next.category;
  }
  if (!sameList(next.colors, stored.colors)) {
    patch.colors = next.colors;
  }
  if (next.pattern !== stored.pattern) {
    patch.pattern = next.pattern;
  }
  if (next.material !== stored.material) {
    patch.material = next.material;
  }
  if (next.formality !== stored.formality) {
    patch.formality = next.formality;
  }
  if (!sameList(next.seasons, stored.seasons)) {
    patch.seasons = next.seasons;
  }
  if (next.warmth !== stored.warmth) {
    patch.warmth = next.warmth;
  }
  if (next.fit !== stored.fit) {
    patch.fit = next.fit;
  }
  if (!sameList(next.occasions, stored.occasions)) {
    patch.occasions = next.occasions;
  }
  return patch;
}

type Translate = (key: MessageKey, params?: Readonly<Record<string, string | number>>) => string;

const MAX_COLORS = 3;

// Formality is stored 1-5; review offers three choices (mockup 02: Casual / Formal / Both).
type FormalityChoice = 'casual' | 'formal' | 'both';
const FORMALITY_CHOICES: readonly { choice: FormalityChoice; value: number }[] = [
  { choice: 'casual', value: 2 },
  { choice: 'formal', value: 4 },
  { choice: 'both', value: 3 },
];

function formalityChoice(formality: number | null): FormalityChoice | null {
  if (formality === null) {
    return null;
  }
  if (formality <= 2) {
    return 'casual';
  }
  return formality >= 4 ? 'formal' : 'both';
}

const WARMTH_LEVELS = ['1', '2', '3'] as const;
type WarmthLevel = (typeof WARMTH_LEVELS)[number];

function warmthLevel(warmth: number | null): WarmthLevel | null {
  const level = String(warmth);
  return WARMTH_LEVELS.find((entry) => entry === level) ?? null;
}

const COLOR_SET: ReadonlySet<string> = new Set(GARMENT_COLORS);

function isGarmentColor(value: string): value is GarmentColor {
  return COLOR_SET.has(value);
}

/** Every palette color with its swatch hex, in palette order. */
const SWATCHES = Object.entries(PALETTE_HEX).filter((entry): entry is [GarmentColor, string] => isGarmentColor(entry[0]));

const ALL_YEAR = 'all_year';

function isAllYear(seasons: readonly Season[]): boolean {
  return SEASONS.every((season) => seasons.includes(season));
}

/** The value as the user reads it, or null when the field is empty. */
function displayValue(field: GarmentField, values: FieldValues, t: Translate): string | null {
  const list = (labels: string[]): string | null => (labels.length === 0 ? null : labels.join(', '));
  switch (field) {
    case 'category':
      return values.category === null ? null : t(`garment.category.${values.category}`);
    case 'colors':
      return list(values.colors.map((color) => t(`garment.color.${color}`)));
    case 'pattern':
      return values.pattern === null ? null : t(`garment.pattern.${values.pattern}`);
    case 'material':
      return values.material === null ? null : t(`garment.material.${values.material}`);
    case 'formality': {
      const choice = formalityChoice(values.formality);
      return choice === null ? null : t(`garment.formality.${choice}`);
    }
    case 'seasons':
      if (isAllYear(values.seasons)) {
        return t('garment.season.all');
      }
      return list(SEASONS.filter((season) => values.seasons.includes(season)).map((season) => t(`garment.season.${season}`)));
    case 'warmth': {
      const level = warmthLevel(values.warmth);
      return level === null ? null : t(`garment.warmth.${level}`);
    }
    case 'fit':
      return values.fit === null ? null : t(`garment.fit.${values.fit}`);
    case 'occasions':
      return list(values.occasions.map((occasion) => t(`occasion.${occasion}`)));
  }
}

/**
 * Category choices: the clothing type's categories, narrowed to the current category's slot when
 * `narrow` (a pair of jeans is offered other bottoms). Clearing the selection shows every category
 * again. The current category always stays listed, even one outside the clothing type.
 */
function categoryOptions(
  values: FieldValues,
  clothingType: ClothingType,
  narrow: boolean,
  t: Translate,
): ChipOption<string>[] {
  const available = new Set(categoriesFor(clothingType));
  const current = values.category;
  const slot = narrow && current !== null ? slotOf(current) : null;
  return GARMENT_CATEGORIES.filter(
    (category) => (available.has(category) || category === current) && (slot === null || slotOf(category) === slot),
  ).map((category) => ({ value: category, label: t(`garment.category.${category}`) }));
}

function editorProps(
  field: GarmentField,
  values: FieldValues,
  onChange: (next: FieldValues) => void,
  clothingType: ClothingType,
  narrowCategory: boolean,
  t: Translate,
): Pick<React.ComponentProps<typeof ChipGroup<string>>, 'options' | 'selected' | 'onChange' | 'multiple' | 'stretch'> {
  const optional = <T,>(value: T | null): T[] => (value === null ? [] : [value]);
  switch (field) {
    case 'category':
      return {
        options: categoryOptions(values, clothingType, narrowCategory, t),
        selected: optional(values.category),
        multiple: false,
        onChange: (next) => {
          onChange({ ...values, category: GARMENT_CATEGORIES.find((category) => category === next[0]) ?? null });
        },
      };
    case 'colors': {
      const full = values.colors.length >= MAX_COLORS;
      return {
        options: SWATCHES.map(([color, hex]) => ({
          value: color,
          label: t(`garment.color.${color}`),
          swatch: hex,
          disabled: full && !values.colors.includes(color),
        })),
        selected: values.colors,
        // Keeps the selection order: the first color is the dominant one.
        onChange: (next) => {
          onChange({ ...values, colors: next.filter(isGarmentColor) });
        },
      };
    }
    case 'pattern':
      return {
        options: GARMENT_PATTERNS.map((pattern) => ({ value: pattern, label: t(`garment.pattern.${pattern}`) })),
        selected: optional(values.pattern),
        multiple: false,
        onChange: (next) => {
          onChange({ ...values, pattern: GARMENT_PATTERNS.find((pattern) => pattern === next[0]) ?? null });
        },
      };
    case 'material':
      return {
        options: GARMENT_MATERIALS.map((material) => ({ value: material, label: t(`garment.material.${material}`) })),
        selected: optional(values.material),
        multiple: false,
        onChange: (next) => {
          onChange({ ...values, material: GARMENT_MATERIALS.find((material) => material === next[0]) ?? null });
        },
      };
    case 'formality':
      return {
        options: FORMALITY_CHOICES.map(({ choice }) => ({ value: choice, label: t(`garment.formality.${choice}`) })),
        selected: optional(formalityChoice(values.formality)),
        multiple: false,
        stretch: true,
        onChange: (next) => {
          const picked = FORMALITY_CHOICES.find(({ choice }) => choice === next[0]);
          onChange({ ...values, formality: picked === undefined ? null : picked.value });
        },
      };
    case 'seasons': {
      const allYear = isAllYear(values.seasons);
      return {
        options: [
          { value: ALL_YEAR, label: t('garment.season.all') },
          ...SEASONS.map((season) => ({ value: season, label: t(`garment.season.${season}`) })),
        ],
        selected: allYear ? [ALL_YEAR, ...values.seasons] : values.seasons,
        onChange: (next) => {
          const wantsAllYear = next.includes(ALL_YEAR);
          let seasons: Season[];
          if (wantsAllYear && !allYear) {
            seasons = [...SEASONS];
          } else if (!wantsAllYear && allYear) {
            seasons = [];
          } else {
            seasons = SEASONS.filter((season) => next.includes(season));
          }
          onChange({ ...values, seasons });
        },
      };
    }
    case 'warmth':
      return {
        options: WARMTH_LEVELS.map((level) => ({ value: level, label: t(`garment.warmth.${level}`) })),
        selected: optional(warmthLevel(values.warmth)),
        multiple: false,
        stretch: true,
        onChange: (next) => {
          const level = WARMTH_LEVELS.find((entry) => entry === next[0]);
          onChange({ ...values, warmth: level === undefined ? null : Number(level) });
        },
      };
    case 'fit':
      return {
        options: GARMENT_FITS.map((fit) => ({ value: fit, label: t(`garment.fit.${fit}`) })),
        selected: optional(values.fit),
        multiple: false,
        onChange: (next) => {
          onChange({ ...values, fit: GARMENT_FITS.find((fit) => fit === next[0]) ?? null });
        },
      };
    case 'occasions':
      // An array column, so several can be chosen (the profile's occasions work the same way).
      return {
        options: OCCASIONS.map((occasion) => ({ value: occasion, label: t(`occasion.${occasion}`) })),
        selected: values.occasions,
        onChange: (next) => {
          onChange({ ...values, occasions: OCCASIONS.filter((occasion) => next.includes(occasion)) });
        },
      };
  }
}

/** One field's choices as chips (mockup 02 review's `.pick`). */
export function FieldEditor(props: {
  field: GarmentField;
  values: FieldValues;
  onChange: (next: FieldValues) => void;
  clothingType: ClothingType;
  /**
   * Category only (default true): offer just the current category's slot. Off when the AI doubted
   * the category itself, since the right answer may be in another slot.
   */
  narrowCategory?: boolean;
  /** Every choice shown but not tappable (e.g. while the AI is still reading the photo). */
  disabled?: boolean;
}): React.JSX.Element {
  const { field, values, onChange, clothingType, narrowCategory = true, disabled = false } = props;
  const { t } = useI18n();
  const editor = editorProps(field, values, onChange, clothingType, narrowCategory, t);
  return (
    <ChipGroup
      {...editor}
      options={disabled ? editor.options.map((option) => ({ ...option, disabled: true })) : editor.options}
      tone="accent"
      accessibilityLabel={t(`garment.field.${field}`)}
    />
  );
}

/** A field the AI was sure of (mockup 02 review's `.row`): "Label · Value ✓", tap to edit. */
export function ConfirmedRow(props: { field: GarmentField; values: FieldValues; onEdit: () => void }): React.JSX.Element {
  const { field, values, onEdit } = props;
  const { t } = useI18n();
  const label = t(`garment.field.${field}`);
  const value = displayValue(field, values, t);
  const shown = value ?? t('review.notSet');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} · ${shown}`}
      accessibilityHint={t('review.edit')}
      onPress={onEdit}
      style={styles.row}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowValue}>
        <Text style={value === null ? styles.unset : styles.value} numberOfLines={1}>
          {shown}
        </Text>
        {value === null ? null : <Text style={styles.check}>✓</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: layout.minHitTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 2,
    borderBottomWidth: StyleSheet.hairlineWidth * 2,
    borderBottomColor: '#eee9f8',
  },
  rowLabel: {
    color: colors.muted,
    fontSize: 14,
  },
  rowValue: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  value: {
    flexShrink: 1,
    color: colors.ink,
    fontSize: 14,
    fontWeight: '700',
  },
  unset: {
    color: colors.muted,
    fontSize: 14,
  },
  check: {
    color: '#16a34a',
    fontSize: 14,
    fontWeight: '800',
  },
});
