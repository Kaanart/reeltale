import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '../../../components/ui';
import { colors, radius, space } from '../../../theme/tokens';

// A titled group of rows on a card. The title is a heading for screen readers. `first` drops the space above
// the group when it opens the screen.
export function Section({ title, children, note, first = false }: { title?: string; children: ReactNode; note?: string; first?: boolean }) {
  return (
    <View style={[styles.section, first && styles.first]}>
      {title ? (
        <Text variant="subheading" accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
      ) : null}
      {children}
      {note ? (
        <Text variant="caption" color="inkMuted" style={styles.note}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

export function Card({ children, padded = false }: { children: ReactNode; padded?: boolean }) {
  return <View style={[styles.card, padded && styles.padded]}>{children}</View>;
}

/** A hairline between rows of a card. */
export function Divider() {
  return <View style={styles.divider} accessible={false} importantForAccessibility="no" />;
}

const styles = StyleSheet.create({
  section: { marginTop: space.xl },
  first: { marginTop: 0 },
  title: { marginBottom: space.sm },
  note: { marginTop: space.sm },
  card: {
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
  },
  padded: { padding: space.lg },
  divider: { height: 1, marginLeft: space.lg, backgroundColor: colors.line },
});
