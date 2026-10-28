import { StyleSheet, Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { colors, theme, type ColorName, type TypeVariant } from '../../theme/tokens';

export interface TextProps extends RNTextProps {
  variant?: TypeVariant;
  color?: ColorName;
  align?: TextStyle['textAlign'];
}

const variantStyles = StyleSheet.create({
  display: theme.type.display,
  title: theme.type.title,
  heading: theme.type.heading,
  subheading: theme.type.subheading,
  body: theme.type.body,
  bodySmall: theme.type.bodySmall,
  caption: theme.type.caption,
});

export function Text({
  variant = 'body',
  color = 'ink',
  align,
  style,
  children,
  allowFontScaling = true,
  maxFontSizeMultiplier = 1.6,
  ...rest
}: TextProps) {
  return (
    <RNText
      allowFontScaling={allowFontScaling}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      {...rest}
      style={[variantStyles[variant], { color: colors[color] }, align ? { textAlign: align } : null, style]}
    >
      {children}
    </RNText>
  );
}
