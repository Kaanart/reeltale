import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '../../../components/ui';
import { colors, fonts, radius, space, type ColorName } from '../../../theme/tokens';

export type NoticeTone = 'info' | 'warn' | 'danger';

const EDGE: Record<NoticeTone, ColorName> = { info: 'line', warn: 'warn', danger: 'danger' };

// A short callout with a coloured edge and its own heading line. Colour is never the only signal: the title
// says what it is.
export function Notice({ title, children, tone = 'info', testID }: { title?: string; children?: ReactNode; tone?: NoticeTone; testID?: string }) {
  return (
    <View style={[styles.box, { borderLeftColor: colors[EDGE[tone]] }]} testID={testID}>
      {title ? (
        <Text variant="body" style={styles.title}>
          {title}
        </Text>
      ) : null}
      {typeof children === 'string' ? (
        <Text variant="bodySmall" color="inkMuted" style={title ? styles.body : undefined}>
          {children}
        </Text>
      ) : children}
    </View>
  );
}

const EDGE_WIDTH = 4;

const styles = StyleSheet.create({
  box: {
    padding: space.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderLeftWidth: EDGE_WIDTH,
    borderRadius: radius.card,
  },
  title: { fontFamily: fonts.sansMedium },
  body: { marginTop: space.xs },
});
