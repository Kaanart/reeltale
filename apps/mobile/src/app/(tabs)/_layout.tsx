import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts, type as typeScale } from '../../theme/tokens';

type IconName = ComponentProps<typeof Ionicons>['name'];

// The five tabs. Titles come from common:nav.*; each icon is outlined when idle and filled when active.
const TABS: { name: string; title: string; icon: IconName; activeIcon: IconName }[] = [
  { name: 'index', title: 'common:nav.home', icon: 'home-outline', activeIcon: 'home' },
  { name: 'discover', title: 'common:nav.discover', icon: 'compass-outline', activeIcon: 'compass' },
  { name: 'create', title: 'common:nav.create', icon: 'add-circle-outline', activeIcon: 'add-circle' },
  { name: 'library', title: 'common:nav.library', icon: 'library-outline', activeIcon: 'library' },
  { name: 'me', title: 'common:nav.me', icon: 'person-circle-outline', activeIcon: 'person-circle' },
];

const ICON_SIZE = 24;
// Room for a 24pt icon and a 16pt-line label (the default 49pt clips Inter labels), plus the home indicator.
const TAB_BAR_HEIGHT = 56;

export default function TabsLayout() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line, height: TAB_BAR_HEIGHT + insets.bottom },
        tabBarLabelStyle: { fontFamily: fonts.sansMedium, fontSize: typeScale.caption.fontSize, lineHeight: typeScale.caption.lineHeight },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t(tab.title),
            // The web would otherwise read the icon glyph too; native keeps React Navigation's "Me, tab, 5 of 5".
            ...(Platform.OS === 'web' ? { tabBarAccessibilityLabel: t(tab.title) } : {}),
            tabBarIcon: ({ focused, color }) => (
              <Ionicons name={focused ? tab.activeIcon : tab.icon} size={ICON_SIZE} color={color} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
