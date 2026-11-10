import { colors } from '../theme';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

// The cards and screens behind text are white or near-white; the screen gradient's lightest stop
// is white and its tinted stops sit behind the CTA zone, not behind body text.
test.each([
  ['ink', colors.ink],
  ['muted', colors.muted],
  ['accent', colors.accent],
  ['accentText', colors.accentText],
  ['error', colors.error],
  ['positiveText', colors.positiveText],
  ['warning', colors.warning],
])('%s text meets WCAG AA (4.5:1) on white', (_token, hex) => {
  expect(contrast(hex, '#ffffff')).toBeGreaterThanOrEqual(4.5);
});

test('error text meets WCAG AA on its own tint', () => {
  expect(contrast(colors.error, colors.errorTint)).toBeGreaterThanOrEqual(4.5);
});
