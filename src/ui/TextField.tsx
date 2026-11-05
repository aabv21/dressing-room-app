import { forwardRef, useState } from 'react';
import type { KeyboardTypeOptions, TextInputInstance, TextInputProps } from 'react-native';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';

import { useI18n } from '../i18n';
import { colors, layout, radii, spacing } from './theme';

const MIN_HIT_TARGET = layout.minHitTarget;

type TextFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  /**
   * The input's placeholder text. Defaults to `label` so existing callers that only pass a label
   * keep working, but mockup 03 screen 1's fields show no separate bold label above them — only a
   * placeholder (e.g. "correo@ejemplo.com") — so callers matching that mockup pass both `label`
   * (for the hidden accessibility label) and a distinct `placeholder`, and set `showLabel={false}`.
   */
  placeholder?: string;
  /** Whether to render `label` visibly above the field. Default true; false shows it as a
   * placeholder-only field (mockup 03) while keeping it as the accessibility label. */
  showLabel?: boolean;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoComplete?: TextInputProps['autoComplete'];
  textContentType?: TextInputProps['textContentType'];
  maxLength?: number;
  returnKeyType?: TextInputProps['returnKeyType'];
  onSubmitEditing?: () => void;
  onBlur?: () => void;
  /** 'submit' keeps focus in this field after `onSubmitEditing` fires (M3's focus-chaining fields
   * call this, then move focus themselves); default (unset) is the platform's normal
   * blur-and-submit behavior. Replaces the deprecated `blurOnSubmit` prop. */
  submitBehavior?: TextInputProps['submitBehavior'];
  error?: string | undefined;
  testID?: string;
  /** Default 'none' (emails, codes); free-text fields such as a city name pass 'words'. */
  autoCapitalize?: TextInputProps['autoCapitalize'];
  /** Rendered inside the field's frame, before / after the input (e.g. a pin icon, a "use my
   * location" action). The frame then wraps all three, so the field still reads as one box. */
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
};

/** `ref` forwards to the underlying `TextInput` so a screen can chain focus between fields
 * (email → password → submit, M3) with `onSubmitEditing`/`ref.current?.focus()`. */
export const TextField = forwardRef<TextInputInstance, TextFieldProps>(function TextField(props, ref) {
  const {
    label,
    value,
    onChangeText,
    placeholder = label,
    showLabel = true,
    secureTextEntry = false,
    keyboardType,
    autoComplete,
    textContentType,
    maxLength,
    returnKeyType,
    onSubmitEditing,
    onBlur,
    submitBehavior,
    error,
    testID,
    autoCapitalize = 'none',
    leading,
    trailing,
  } = props;
  const { t } = useI18n();
  // Secure fields start masked; a visibility toggle reveals the typed value without changing
  // `secureTextEntry`'s default, matching the mockup's password field.
  const [revealed, setRevealed] = useState(false);
  const isPassword = secureTextEntry;
  const framed = leading !== undefined || trailing !== undefined;

  return (
    <View style={styles.container} testID={testID !== undefined ? `${testID}-container` : undefined}>
      {/* `importantForAccessibility="no"` (Android) + `accessibilityElementsHidden` (iOS): the
          TextInput below already carries this same text as its `accessibilityLabel`, so a screen
          reader would otherwise announce the label twice — once as this plain Text, once as the
          input's label — whenever a caller shows the visible label (`showLabel` true, the
          default; every current auth-screen caller sets it false and relies on `placeholder`
          instead, but this guards any future/other caller that doesn't). */}
      {showLabel ? (
        <Text style={styles.label} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {label}
        </Text>
      ) : null}
      <View style={[styles.fieldRow, framed ? styles.frame : null]}>
        {leading}
        <TextInput
          ref={ref}
          testID={testID}
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={isPassword && !revealed}
          keyboardType={keyboardType}
          autoComplete={autoComplete}
          textContentType={textContentType}
          maxLength={maxLength}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          onBlur={onBlur}
          submitBehavior={submitBehavior}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          style={[styles.input, isPassword ? styles.inputWithToggle : null, framed ? styles.inputInFrame : null]}
        />
        {trailing}
        {isPassword ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? t('auth.password.hide') : t('auth.password.show')}
            onPress={() => {
              setRevealed((prev) => !prev);
            }}
            style={styles.toggle}
            hitSlop={12}
          >
            {revealed ? <EyeOff size={18} color={colors.muted} /> : <Eye size={18} color={colors.muted} />}
          </Pressable>
        ) : null}
      </View>
      {error !== undefined ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
  },
  fieldRow: {
    position: 'relative',
    justifyContent: 'center',
  },
  input: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.cell,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.ink,
    minHeight: MIN_HIT_TARGET,
  },
  frame: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.cell,
    paddingHorizontal: spacing.md,
    minHeight: MIN_HIT_TARGET,
  },
  inputInFrame: {
    flex: 1,
    borderWidth: 0,
    paddingHorizontal: 0,
    backgroundColor: 'transparent',
  },
  inputWithToggle: {
    paddingRight: spacing.xl,
  },
  toggle: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    minWidth: MIN_HIT_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    color: colors.error,
    fontSize: 12,
    fontWeight: '600',
  },
});
