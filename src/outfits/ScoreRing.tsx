// Mockup 01 screen 3's `.ring`: the score as an arc stroked in the ai gradient over a light track,
// with the percentage and the label in the middle.
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

import { colors, gradients } from '../ui/theme';

const SIZE = 112;
const STROKE = 10;
const RADIUS = (SIZE - STROKE) / 2;
const CENTER = SIZE / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const GRADIENT_ID = 'scoreRingAi';
const NUMBER_LINE = 32;
const CAPTION_LINE = 16;

function AiGradient(): React.JSX.Element {
  return (
    <Defs>
      <LinearGradient id={GRADIENT_ID} x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor={gradients.ai[0]} />
        <Stop offset="1" stopColor={gradients.ai[1]} />
      </LinearGradient>
    </Defs>
  );
}

/**
 * The score (0–100) as a progress ring. The ring and its number are one accessible progressbar
 * ("78%"); the caption under the number (the label, e.g. "Looks good") sits outside it, so a screen
 * reader reads it as its own text instead of losing it inside the progressbar.
 */
export function ScoreRing({ score, caption }: { score: number; caption: string }): React.JSX.Element {
  const value = Math.min(100, Math.max(0, Math.round(score)));
  const percent = `${String(value)}%`;
  return (
    <View style={styles.box}>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={percent}
        accessibilityValue={{ min: 0, max: 100, now: value }}
        style={StyleSheet.absoluteFill}
      >
        <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
          <AiGradient />
          <Circle cx={CENTER} cy={CENTER} r={RADIUS} stroke={colors.track} strokeWidth={STROKE} fill="none" />
          {value === 0 ? null : (
            <Circle
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              stroke={`url(#${GRADIENT_ID})`}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${String(CIRCUMFERENCE)} ${String(CIRCUMFERENCE)}`}
              strokeDashoffset={CIRCUMFERENCE * (1 - value / 100)}
              // Starts the arc at 12 o'clock, like the mockup's conic gradient.
              transform={`rotate(-90 ${String(CENTER)} ${String(CENTER)})`}
              fill="none"
            />
          )}
        </Svg>
        <View style={[StyleSheet.absoluteFill, styles.numberSlot]}>
          <Text style={styles.number}>{percent}</Text>
        </View>
      </View>
      {/* The number and the caption stack around the center: each slot is padded by the other's
          line height, so the pair stays centered without measuring. */}
      <View style={[StyleSheet.absoluteFill, styles.captionSlot]} pointerEvents="none">
        <Text style={styles.caption} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
          {caption}
        </Text>
      </View>
    </View>
  );
}

/** The ring while the rating is on its way: the whole track in the ai gradient, faded, with a spinner. */
export function ScoreRingPlaceholder(): React.JSX.Element {
  return (
    <View style={styles.box} testID="score-ring-placeholder">
      <Svg width={SIZE} height={SIZE} style={[StyleSheet.absoluteFill, styles.faded]}>
        <AiGradient />
        <Circle cx={CENTER} cy={CENTER} r={RADIUS} stroke={`url(#${GRADIENT_ID})`} strokeWidth={STROKE} fill="none" />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.spinnerSlot]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: SIZE,
    height: SIZE,
    alignSelf: 'center',
  },
  numberSlot: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: CAPTION_LINE,
  },
  captionSlot: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: NUMBER_LINE,
    paddingHorizontal: STROKE + 4,
  },
  spinnerSlot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  number: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: '900',
    lineHeight: NUMBER_LINE,
  },
  caption: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: CAPTION_LINE,
    textAlign: 'center',
  },
  faded: {
    opacity: 0.35,
  },
});
