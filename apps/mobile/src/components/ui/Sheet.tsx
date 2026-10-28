import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, space } from '../../theme/tokens';
import { Text } from './Text';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

const CLOSE_TARGET = 44;

export function Sheet({ visible, onClose, title, children }: SheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        {/* Tap-outside shortcut. Screen readers use the Close button in the header instead. */}
        <Pressable
          style={styles.scrim}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <View
          accessibilityViewIsModal
          style={[styles.container, { paddingBottom: insets.bottom + space.lg }]}
        >
          {/* Visual affordance only; the sheet is dismissed by the scrim, the button or back. */}
          <View style={styles.handle} />
          <View style={styles.header}>
            {title ? (
              <Text variant="heading" accessibilityRole="header" style={styles.title}>
                {title}
              </Text>
            ) : (
              <View style={styles.title} />
            )}
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={styles.closeButton}
            >
              <View style={styles.closeIcon}>
                <View style={[styles.closeBar, styles.closeBarA]} />
                <View style={[styles.closeBar, styles.closeBarB]} />
              </View>
            </Pressable>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.scrim,
  },
  container: {
    maxHeight: '90%',
    paddingHorizontal: space.lg,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    marginTop: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.line,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: CLOSE_TARGET,
    marginBottom: space.sm,
  },
  title: { flex: 1 },
  closeButton: {
    width: CLOSE_TARGET,
    height: CLOSE_TARGET,
    marginRight: -space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeIcon: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBar: {
    position: 'absolute',
    width: 20,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.ink,
  },
  closeBarA: { transform: [{ rotate: '45deg' }] },
  closeBarB: { transform: [{ rotate: '-45deg' }] },
});
