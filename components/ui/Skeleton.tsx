import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, ViewStyle, DimensionValue } from 'react-native';
import { COLORS, SPACING, SHADOWS } from '@/constants';

type Props = {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: ViewStyle;
};

/**
 * Shimmering placeholder block. Plain RN Animated (not Reanimated) so it
 * works everywhere, including Expo Go.
 */
export function Skeleton({ width = '100%', height = 16, radius = 8, style }: Props) {
  const opacity = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: 650, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, backgroundColor: COLORS.border, opacity },
        style,
      ]}
    />
  );
}

/** Card-shaped skeleton mimicking a plan row: avatar circle + two text lines. */
export function SkeletonRow() {
  return (
    <View style={styles.row}>
      <Skeleton width={40} height={40} radius={20} />
      <View style={{ flex: 1, gap: 8 }}>
        <Skeleton width="70%" height={14} />
        <Skeleton width="45%" height={11} />
      </View>
    </View>
  );
}

/** Full-screen list placeholder: a hero block + a few rows. */
export function SkeletonList() {
  return (
    <View style={styles.list}>
      <Skeleton height={148} radius={20} />
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: SPACING.lg,
    ...SHADOWS.card,
  },
  list: {
    padding: SPACING.lg,
    gap: SPACING.md,
  },
});
