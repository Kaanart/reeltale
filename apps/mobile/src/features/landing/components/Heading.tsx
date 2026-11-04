import type { ReactNode } from 'react';

import { Text, type TextProps } from '../../../components/ui';

// A heading with a real level on the web (<h1> … <h3>), so the public pages have an outline screen readers
// can jump through. React Native's own `header` role always becomes <h1> there.

export interface HeadingProps extends Omit<TextProps, 'role' | 'accessibilityRole'> {
  level: 1 | 2 | 3;
  children: ReactNode;
}

export function Heading({ level, children, variant, ...rest }: HeadingProps) {
  const fallback = level === 1 ? 'display' : level === 2 ? 'title' : 'heading';
  // aria-level is a web prop React Native's types don't list; react-native-web turns it into <hN>.
  const web = { 'aria-level': level } as object;
  return (
    <Text role="heading" {...web} variant={variant ?? fallback} {...rest}>
      {children}
    </Text>
  );
}
