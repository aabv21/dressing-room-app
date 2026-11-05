import Svg, { Circle, Polygon } from 'react-native-svg';

import type { BodyType } from '../profile/bodyType';
import { colors } from './theme';

/**
 * Body outlines on mockup 03's 60×100 grid: a head circle plus one polygon (shoulders → waist →
 * hips → hem). The first five are the mockup's own points; trapezoid, triangle and oval (the
 * masculine-only shapes) are drawn in the same style.
 */
function polygonFor(type: BodyType): string {
  switch (type) {
    case 'hourglass':
      return '12,20 48,20 39,46 50,66 44,96 16,96 10,66 21,46';
    case 'pear':
      return '19,20 41,20 39,46 52,68 46,96 14,96 8,68 21,46';
    case 'apple':
      return '15,20 45,20 50,46 45,68 42,96 18,96 15,68 10,46';
    case 'rectangle':
      return '16,20 44,20 43,46 44,68 42,96 18,96 16,68 17,46';
    case 'inverted_triangle':
      return '8,20 52,20 41,46 40,68 38,96 22,96 20,68 19,46';
    case 'trapezoid':
      // Broad shoulders tapering to a defined waist, hips a little narrower than the shoulders.
      return '10,20 50,20 41,46 43,68 41,96 19,96 17,68 19,46';
    case 'triangle':
      // Narrow shoulders widening down to the hips.
      return '20,20 40,20 42,46 49,68 45,96 15,96 11,68 18,46';
    case 'oval':
      // Rounded through the middle: the sides bow out between shoulders and hips.
      return '17,20 43,20 49,34 51,50 47,68 42,96 18,96 13,68 9,50 11,34';
  }
}

const FILL_OFF = '#d9cdf7';

export function Silhouette({ type, selected }: { type: BodyType; selected: boolean }): React.JSX.Element {
  const fill = selected ? colors.accent : FILL_OFF;
  return (
    <Svg width={34} height={56} viewBox="0 0 60 100" testID={`silhouette-${type}`}>
      <Circle cx={30} cy={9} r={7} fill={fill} />
      <Polygon points={polygonFor(type)} fill={fill} />
    </Svg>
  );
}
