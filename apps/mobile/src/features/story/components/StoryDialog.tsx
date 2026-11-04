import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { focusRing, useInteraction } from '../../../components/layout';
import { Text } from '../../../components/ui';
import { colors, layout, radius, space } from '../../../theme/tokens';

// A centred dialog for the story screens on a laptop-sized window (the phone layout uses the bottom Sheet). On the
// web, react-native-web's Modal is the dialog element (role="dialog", aria-modal), traps the focus inside it and
// closes on Escape; clicking outside closes it too. The heading names it.

export interface StoryDialogProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  testID?: string;
}

const ICON = 22;

export function StoryDialog({ visible, onClose, title, children, testID }: StoryDialogProps) {
  const { t } = useTranslation();
  const close = useInteraction();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Click outside to close. Keyboard and screen-reader users have the Close button and Escape. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          aria-hidden
          tabIndex={-1}
        />
        <View style={styles.card} aria-label={title} testID={testID}>
          <View style={styles.header}>
            <Text variant="heading" accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t('common:actions.close')}
              {...close.handlers}
              style={({ pressed }) => [
                styles.close,
                (close.hovered || pressed) && styles.closeHover,
                close.focusVisible && focusRing,
              ]}
              testID={testID ? `${testID}-close` : undefined}
            >
              <Ionicons name="close" size={ICON} color={colors.ink} />
            </Pressable>
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
    backgroundColor: colors.scrim,
  },
  card: {
    width: '100%',
    maxWidth: layout.narrowMaxWidth,
    maxHeight: '90%',
    borderRadius: radius.sheet,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: space.xl,
    paddingRight: space.md,
    paddingTop: space.lg,
    paddingBottom: space.sm,
  },
  title: { flex: 1 },
  close: {
    width: layout.minTarget,
    height: layout.minTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  closeHover: { backgroundColor: colors.surfaceAlt },
  scroll: { flexGrow: 0 },
  body: { paddingHorizontal: space.xl, paddingBottom: space.xl },
});
