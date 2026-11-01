import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';

import { Text } from '../../../components/ui';
import { colors, fonts, radius } from '../../../theme/tokens';

const SIZE = 72;

// The placeholder avatar: the first letter of the name on a soft circle, or a person when there is no name.
// Decorative: the name is read out next to it. `aria-hidden` hides the letter inside too, on every platform
// (accessible={false} doesn't hide children on iOS, and react-native-web ignores it).
export function Avatar({ initial }: { initial: string }) {
  return (
    <View style={styles.circle} aria-hidden>
      {initial ? (
        <Text variant="heading" color="inkMuted" style={styles.initial}>
          {initial}
        </Text>
      ) : (
        <Ionicons name="person" size={SIZE / 2} color={colors.inkMuted} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.line,
  },
  initial: { fontFamily: fonts.serifBold },
});
