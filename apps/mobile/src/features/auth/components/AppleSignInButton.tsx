import * as AppleAuthentication from 'expo-apple-authentication';
import { StyleSheet, View } from 'react-native';

import { radius } from '../../../theme/tokens';

// iOS: Apple's own button (App Store guideline 4.8 and the HIG want the system button; its label is
// localised by iOS). Only rendered where Sign in with Apple is available. The web has its own file.
export interface AppleSignInButtonProps {
  onPress: () => void;
  busy?: boolean;
}

const HEIGHT = 48;

export function AppleSignInButton({ onPress, busy = false }: AppleSignInButtonProps) {
  return (
    <View style={busy && styles.busy} pointerEvents={busy ? 'none' : 'auto'} accessibilityState={{ busy }}>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={radius.card}
        onPress={onPress}
        style={styles.button}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  button: { width: '100%', height: HEIGHT },
  busy: { opacity: 0.5 },
});
