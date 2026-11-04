// A centred dialog: the unlock sheet on a laptop (logic/desktop.ts unlockPresentation). Same props as the
// bottom Sheet in components/ui, so the sheet's body goes into either.
//
// React Native's Modal does the hard parts in the browser (react-native-web 0.21): a portal with
// role="dialog" and aria-modal, Tab kept inside, Escape calls onRequestClose, and focus goes back to the
// element that opened it when it closes. This adds the card, the title the dialog is labelled by, a Close
// button that comes first in the tab order (so Enter never unlocks by accident), and closing on a click
// outside the card.

import Ionicons from '@expo/vector-icons/Ionicons';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { focusRing, useInteraction } from '../../../components/layout';
import { Text } from '../../../components/ui';
import { colors, layout, radius, space } from '../../../theme/tokens';

export interface DialogProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

const MAX_WIDTH = 440;
const CLOSE_ICON = 22;

export function Dialog({ visible, onClose, title, children }: DialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  // The scrim is a plain view (not a button): the focus trap would otherwise reach it with Shift+Tab. On the
  // web a click on it closes; keyboard and screen reader users have Escape and the Close button.
  const scrimClick = Platform.OS === 'web' ? ({ onClick: onClose } as object) : {};

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      aria-labelledby={title ? titleId : undefined}
      aria-label={title ? undefined : t('common:actions.close')}
    >
      <View style={styles.root}>
        <View style={styles.card} testID="watch-dialog">
          <View style={styles.header}>
            {title ? (
              <Text variant="heading" accessibilityRole="header" nativeID={titleId} style={styles.title}>
                {title}
              </Text>
            ) : (
              <View style={styles.title} />
            )}
            <CloseButton label={t('common:actions.close')} onPress={onClose} />
          </View>
          {children}
        </View>
        <View style={styles.scrim} aria-hidden {...scrimClick} />
      </View>
    </Modal>
  );
}

function CloseButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { focusVisible, hovered, handlers } = useInteraction();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID="watch-dialog-close"
      {...handlers}
      style={({ pressed }) => [styles.close, (hovered || pressed) && styles.closeHover, focusVisible && focusRing]}
    >
      <Ionicons name="close" size={CLOSE_ICON} color={colors.ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  card: {
    zIndex: 1,
    width: '100%',
    maxWidth: MAX_WIDTH,
    maxHeight: '90%',
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.lg,
    borderRadius: radius.sheet,
    backgroundColor: colors.surface,
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    zIndex: 0,
    backgroundColor: colors.scrim,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: layout.minTarget,
    marginBottom: space.sm,
  },
  title: { flex: 1 },
  close: {
    width: layout.minTarget,
    height: layout.minTarget,
    marginRight: -space.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  closeHover: { backgroundColor: colors.surfaceAlt },
});
