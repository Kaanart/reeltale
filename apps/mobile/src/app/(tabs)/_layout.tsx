import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NAV_ITEMS, useLayout } from '../../components/layout';
import { colors, fonts, type as typeScale } from '../../theme/tokens';

type IconName = ComponentProps<typeof Ionicons>['name'];

// The five tabs (NAV_ITEMS in components/layout/logic.ts). Titles come from common:nav.*; each icon is
// outlined when idle and filled when active. On the web at medium and wide widths the top bar (SiteShell)
// replaces the bottom tab bar; phones and the native apps keep it. Page titles of the tabs come from the
// shell (the tab's name) until a tab screen sets its own with usePageTitle().

const ICON_SIZE = 24;
// Room for a 24pt icon and a 16pt-line label (the default 49pt clips Inter labels), plus the home indicator.
const TAB_BAR_HEIGHT = 56;

const hiddenTabBar = () => null;

export default function TabsLayout() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { hasTopNav } = useLayout();
  return (
    <Tabs
      tabBar={hasTopNav ? hiddenTabBar : undefined}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line, height: TAB_BAR_HEIGHT + insets.bottom },
        tabBarLabelStyle: { fontFamily: fonts.sansMedium, fontSize: typeScale.caption.fontSize, lineHeight: typeScale.caption.lineHeight },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      {NAV_ITEMS.map((tab) => (
        <Tabs.Screen
          key={tab.route}
          name={tab.route}
          options={{
            title: t(tab.labelKey),
            // The web would otherwise read the icon glyph too; native keeps React Navigation's "Me, tab, 5 of 5".
            ...(Platform.OS === 'web' ? { tabBarAccessibilityLabel: t(tab.labelKey) } : {}),
            tabBarIcon: ({ focused, color }) => (
              <Ionicons name={(focused ? tab.activeIcon : tab.icon) as IconName} size={ICON_SIZE} color={color} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
