// Mockup 01 screen 3's `.ring`: the score as an arc stroked in the ai gradient over a light track,
// with the percentage and the label in the middle.
import { ActivityIndicator, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

import { useI18n } from '../i18n';
import { colors, gradients, textScale } from '../ui/theme';

const SIZE = 112;
const STROKE = 10;
const GRADIENT_ID = 'scoreRingAi';
const NUMBER_LINE = 32;
const CAPTION_LINE = 16;

type Geometry = {
  size: number;
  stroke: number;
  radius: number;
  center: number;
  circumference: number;
  numberLine: number;
  captionLine: number;
};

/**
 * The ring's measures at the current text size: the number and caption grow up to `textScale.ring`,
 * and the ring grows by the same factor, so the caption keeps its default clearance from the arc.
 */
function useGeometry(): Geometry {
  const { fontScale } = useWindowDimensions();
  const scale = Math.min(Math.max(fontScale, 1), textScale.ring);
  const size = SIZE * scale;
  const stroke = STROKE * scale;
  const radius = (size - stroke) / 2;
  return {
    size,
    stroke,
    radius,
    center: size / 2,
    circumference: 2 * Math.PI * radius,
    numberLine: NUMBER_LINE * scale,
    captionLine: CAPTION_LINE * scale,
  };
}

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
 * The score (0–100) as a progress ring, drawn at its final value (it never animates). The ring and
 * its number are one accessible progressbar named "Score", whose value carries the score, so a
 * screen reader says it once; the caption under the number (the label, e.g. "Looks good") sits
 * outside it, so it's read as its own text instead of being lost inside the progressbar.
 */
export function ScoreRing({ score, caption }: { score: number; caption: string }): React.JSX.Element {
  const { t } = useI18n();
  const g = useGeometry();
  const value = Math.min(100, Math.max(0, Math.round(score)));
  const percent = `${String(value)}%`;
  return (
    <View style={[styles.box, { width: g.size, height: g.size }]} testID="score-ring">
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={t('rate.score')}
        accessibilityValue={{ min: 0, max: 100, now: value }}
        style={StyleSheet.absoluteFill}
      >
        <Svg width={g.size} height={g.size} style={StyleSheet.absoluteFill}>
          <AiGradient />
          <Circle cx={g.center} cy={g.center} r={g.radius} stroke={colors.track} strokeWidth={g.stroke} fill="none" />
          {value === 0 ? null : (
            <Circle
              testID="score-ring-arc"
              cx={g.center}
              cy={g.center}
              r={g.radius}
              stroke={`url(#${GRADIENT_ID})`}
              strokeWidth={g.stroke}
              strokeLinecap="round"
              strokeDasharray={`${String(g.circumference)} ${String(g.circumference)}`}
              strokeDashoffset={g.circumference * (1 - value / 100)}
              // Starts the arc at 12 o'clock, like the mockup's conic gradient.
              transform={`rotate(-90 ${String(g.center)} ${String(g.center)})`}
              fill="none"
            />
          )}
        </Svg>
        <View style={[StyleSheet.absoluteFill, styles.centered, { paddingBottom: g.captionLine }]}>
          <Text style={styles.number} maxFontSizeMultiplier={textScale.ring}>
            {percent}
          </Text>
        </View>
      </View>
      {/* The number and the caption stack around the center: each slot is padded by the other's
          line height, so the pair stays centered without measuring. */}
      <View
        style={[
          StyleSheet.absoluteFill,
          styles.centered,
          { paddingTop: g.numberLine, paddingHorizontal: g.stroke + 4 },
        ]}
        pointerEvents="none"
      >
        <Text
          style={styles.caption}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          maxFontSizeMultiplier={textScale.ring}
        >
          {caption}
        </Text>
      </View>
    </View>
  );
}

/** The ring while the rating is on its way: the whole track in the ai gradient, faded, with a spinner. */
export function ScoreRingPlaceholder(): React.JSX.Element {
  const g = useGeometry();
  return (
    <View style={[styles.box, { width: g.size, height: g.size }]} testID="score-ring-placeholder">
      <Svg width={g.size} height={g.size} style={[StyleSheet.absoluteFill, styles.faded]}>
        <AiGradient />
        <Circle
          cx={g.center}
          cy={g.center}
          r={g.radius}
          stroke={`url(#${GRADIENT_ID})`}
          strokeWidth={g.stroke}
          fill="none"
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.centered]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignSelf: 'center',
  },
  centered: {
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
