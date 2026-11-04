import { usePathname } from 'expo-router';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';

import { isPublicWebPath, type Gate } from '../../lib/gate';
import { colors } from '../../theme/tokens';
import { defaultTitleKey, formatPageTitle } from './logic';
import { shellStore } from './shellStore';
import { SiteHeader } from './SiteHeader';
import { useLayout } from './useLayout';

// The web frame around every screen (the root layout wraps its Stack in it):
//   - the top bar: signed-in adults at medium and wide widths ('app'); everyone else on the public pages at
//     any width ('public'); nothing on the sign-in screens, on phone-sized windows for adults (the bottom
//     tabs are there), or while a screen asks with useHideTopNav()
//   - the browser tab's title: the focused screen's usePageTitle(), else the tab's name, else 'ReelTale'
// In the native apps it renders its children and nothing else.

export interface SiteShellProps {
  /** Where the account stands (the root layout's settled gate): only 'ready' gets the app's top bar. */
  gate: Gate | null;
  children: ReactNode;
}

export function SiteShell({ gate, children }: SiteShellProps) {
  if (Platform.OS !== 'web') return <>{children}</>;
  return <WebShell gate={gate}>{children}</WebShell>;
}

function WebShell({ gate, children }: SiteShellProps) {
  const { t } = useTranslation();
  const ready = gate === 'ready';
  const { hasTopNav } = useLayout();
  const pathname = usePathname();
  const shell = useSyncExternalStore(shellStore.subscribe, shellStore.get, shellStore.get);

  const fallbackKey = defaultTitleKey(pathname);
  const title = formatPageTitle(shell.title ?? (ready && fallbackKey ? t(fallbackKey) : null), t('common:appName'));
  useEffect(() => {
    if (typeof document !== 'undefined') document.title = title;
  }, [title]);

  const variant = ready ? (hasTopNav ? 'app' : null) : isPublicWebPath(pathname) ? 'public' : null;
  const header = variant !== null && !shell.topNavHidden ? <SiteHeader variant={variant} gate={gate} /> : null;

  return (
    <View style={styles.shell}>
      {header}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1 },
});
