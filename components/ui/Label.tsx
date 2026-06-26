import { ReactNode } from 'react';
import { Text, StyleSheet, TextStyle } from 'react-native';
import { COLORS, FONTS } from '@/constants';

type Props = {
  children: ReactNode;
  style?: TextStyle;
};

export function Label({ children, style }: Props) {
  return (
    <Text style={[styles.label, style]}>{children}</Text>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 12,
    fontFamily: FONTS.bold,
    color: COLORS.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    includeFontPadding: false,
  },
});
