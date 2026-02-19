import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Circle, Line, G } from 'react-native-svg';
import { Colors } from '@/constants/theme';

interface LogoProps {
  size?: number;
}

export default function Logo({ size = 60 }: LogoProps) {
  const lineWidth = Math.max(2.5, size / 24);
  const arcRadius = size / 2.6;
  const dotRadius = size / 12;

  return (
    <View style={styles.container}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <G>
          {/* C arc (75% of circle, from 45 to 315 degrees) with squared edges */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={arcRadius}
            fill="none"
            stroke={Colors.accent}
            strokeWidth={size / 8}
            strokeLinecap="butt"
            strokeDasharray={`${(270 / 360) * 2 * Math.PI * arcRadius} ${2 * Math.PI * arcRadius}`}
            strokeDashoffset={`${(-45 / 360) * 2 * Math.PI * arcRadius}`}
            rotation={0}
            origin={`${size / 2}, ${size / 2}`}
          />

          {/* Center dot */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={dotRadius}
            fill={Colors.purple}
          />

          {/* Diagonal line (in front) */}
          <Line
            x1="0"
            y1="0"
            x2={size}
            y2={size}
            stroke={Colors.purple}
            strokeWidth={lineWidth}
            strokeLinecap="butt"
          />
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
