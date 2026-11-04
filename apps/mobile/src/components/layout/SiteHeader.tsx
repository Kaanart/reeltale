import Ionicons from '@expo/vector-icons/Ionicons';
import { usePathname, type Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { useWallet } from '../../features/me';
import { GATE_PATHS, isAuthGate, type Gate } from '../../lib/gate';
import { colors, fonts, layout, radius, space, type as typeScale } from '../../theme/tokens';
import { Text } from '../ui';
import { isWalletPath, NAV_ITEMS, navMatch, type NavItem } from './logic';
import { focusRing, ShellLink, type InteractionState } from './ShellLink';
import { useLayout } from './useLayout';

type IconName = ComponentProps<typeof Ionicons>['name'];

// The web top bar (SiteShell shows it). 'app': signed-in adults at medium and wide widths, in place of the
// bottom tabs: wordmark, Home / Discover / Create / Library, search, the coin balance (to /wallet) and Me.
// 'public': everyone else on the public pages (/about, /notice, the landing page): wordmark and Sign in, or
// Continue (back to the birthday / Terms / blocked screen) for an account that is signed in but not through.
// It sits above the page's scroll area, so it stays put while the page scrolls.

export interface SiteHeaderProps {
  variant: 'app' | 'public';
  /** The settled gate: picks Sign in or Continue in the public variant. */
  gate?: Gate | null;
}

const SEARCH_HREF = { pathname: '/discover', params: { focus: 'search' } } as unknown as Href;

export function SiteHeader({ variant, gate = null }: SiteHeaderProps) {
  const { t } = useTranslation();
  // Signed in but not through the gate: back to that step instead of "Sign in".
  const resume = gate !== null && isAuthGate(gate) && gate !== 'signedOut' ? gate : null;
  const { gutter, isWide } = useLayout();
  const pathname = usePathname();

  return (
    <View role="banner" style={styles.bar}>
      <View
        role="navigation"
        aria-label={t('common:tabs.a11y')}
        style={[styles.inner, { paddingHorizontal: gutter, maxWidth: layout.contentMaxWidth + 2 * gutter }]}
      >
        <ShellLink
          href="/"
          accessibilityLabel={t('common:shell.homeA11y')}
          linkStyle={(s) => [styles.wordmarkLink, s.focusVisible && focusRing]}
          render={() => (
            <Text variant="heading" style={styles.wordmark} numberOfLines={1}>
              {t('common:appName')}
            </Text>
          )}
        />

        {variant === 'app' ? (
          <>
            <View style={styles.links}>
              {NAV_ITEMS.filter((item) => item.key !== 'me').map((item) => (
                <NavTab key={item.key} item={item} match={navMatch(pathname, item.key)} />
              ))}
            </View>
            <View style={styles.spacer} />
            <ShellLink
              href={SEARCH_HREF}
              accessibilityLabel={t('common:actions.search')}
              linkStyle={(s) => [styles.iconButton, (s.hovered || s.pressed) && styles.hover, s.focusVisible && focusRing]}
              render={() => <Icon name="search" />}
            />
            <WalletChip current={isWalletPath(pathname)} />
            <MeLink match={navMatch(pathname, 'me')} showLabel={isWide} />
          </>
        ) : (
          <>
            <View style={styles.spacer} />
            <ShellLink
              href={resume ? GATE_PATHS[resume] : GATE_PATHS.signedOut}
              testID="topnav-signin"
              linkStyle={(s) => [styles.signIn, (s.hovered || s.pressed) && styles.signInHover, s.focusVisible && focusRing]}
              render={() => (
                <Text variant="bodySmall" color="onAccent" style={styles.signInLabel}>
                  {resume ? t('common:actions.continue') : t('common:shell.signIn')}
                </Text>
              )}
            />
          </>
        )}
      </View>
    </View>
  );
}

function Icon({ name, color = colors.ink }: { name: IconName; color?: string }) {
  return (
    <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Ionicons name={name} size={ICON} color={color} />
    </View>
  );
}

function NavTab({ item, match }: { item: NavItem; match: 'page' | 'section' | null }) {
  const { t } = useTranslation();
  const active = match !== null;
  const label = t(item.labelKey);
  return (
    <ShellLink
      href={item.href}
      current={match === 'page' ? 'page' : match === 'section' ? 'true' : null}
      accessibilityLabel={label}
      testID={`topnav-${item.key}`}
      linkStyle={(s: InteractionState) => [styles.tab, (s.hovered || s.pressed) && styles.hover, s.focusVisible && focusRing]}
      render={() => (
        <>
          <Text variant="body" color={active ? 'ink' : 'inkMuted'} style={styles.tabLabel} numberOfLines={1}>
            {label}
          </Text>
          <View style={[styles.indicator, active && styles.indicatorOn]} />
        </>
      )}
    />
  );
}

function WalletChip({ current }: { current: boolean }) {
  const { t } = useTranslation();
  const wallet = useWallet();
  const balance = wallet.data?.balance;
  const label = balance === undefined ? t('common:shell.wallet') : t('common:shell.walletBalance', { count: balance });
  return (
    <ShellLink
      href="/wallet"
      current={current ? 'page' : null}
      accessibilityLabel={label}
      testID="topnav-wallet"
      linkStyle={(s) => [styles.chip, current && styles.chipCurrent, (s.hovered || s.pressed) && styles.chipHover, s.focusVisible && focusRing]}
      render={() => (
        <>
          <View style={styles.coin} />
          <Text variant="bodySmall" style={styles.chipText} numberOfLines={1}>
            {balance === undefined ? t('common:shell.wallet') : t('common:shell.balance', { count: balance })}
          </Text>
        </>
      )}
    />
  );
}

function MeLink({ match, showLabel }: { match: 'page' | 'section' | null; showLabel: boolean }) {
  const { t } = useTranslation();
  const active = match !== null;
  const me = NAV_ITEMS.find((i) => i.key === 'me')!;
  return (
    <ShellLink
      href={me.href}
      current={match === 'page' ? 'page' : match === 'section' ? 'true' : null}
      accessibilityLabel={t(me.labelKey)}
      testID="topnav-me"
      linkStyle={(s) => [styles.me, (s.hovered || s.pressed) && styles.hover, s.focusVisible && focusRing]}
      render={() => (
        <>
          <Icon name={(active ? me.activeIcon : me.icon) as IconName} />
          {showLabel ? (
            <Text variant="body" color={active ? 'ink' : 'inkMuted'} style={styles.tabLabel} numberOfLines={1}>
              {t(me.labelKey)}
            </Text>
          ) : null}
        </>
      )}
    />
  );
}

const ICON = 22;
const COIN = 14;
const INDICATOR = 3;

const styles = StyleSheet.create({
  bar: {
    width: '100%',
    height: layout.navHeight,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    zIndex: 10,
  },
  inner: {
    flex: 1,
    width: '100%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  wordmarkLink: {
    minHeight: layout.minTarget,
    justifyContent: 'center',
    paddingRight: space.lg,
    borderRadius: radius.chip,
  },
  wordmark: { fontFamily: fonts.serifBold },
  links: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  spacer: { flex: 1 },
  tab: {
    minHeight: layout.minTarget,
    paddingHorizontal: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.chip,
  },
  tabLabel: { fontFamily: fonts.sansMedium },
  // The active tab's underline: decoration next to the (ink) label, so the brand accent is fine (3.6:1 > 3:1).
  indicator: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    bottom: space.xs,
    height: INDICATOR,
    borderRadius: INDICATOR,
    backgroundColor: 'transparent',
  },
  indicatorOn: { backgroundColor: colors.accent },
  hover: { backgroundColor: colors.surfaceAlt },
  iconButton: {
    width: layout.minTarget,
    height: layout.minTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: layout.minTarget - space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  chipHover: { borderColor: colors.line },
  chipCurrent: { borderColor: colors.ink },
  coin: {
    width: COIN,
    height: COIN,
    borderRadius: COIN / 2,
    marginRight: space.sm,
    backgroundColor: colors.coin,
    borderWidth: 1.5,
    borderColor: colors.warn,
  },
  chipText: { fontFamily: fonts.sansBold },
  me: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: layout.minTarget,
    minWidth: layout.minTarget,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
  },
  signIn: {
    minHeight: layout.minTarget - space.xs,
    paddingHorizontal: space.lg,
    justifyContent: 'center',
    borderRadius: radius.card,
    backgroundColor: colors.accentStrong,
  },
  signInHover: { backgroundColor: colors.accentStrongPressed },
  signInLabel: { fontFamily: fonts.sansBold, lineHeight: typeScale.bodySmall.lineHeight },
});
