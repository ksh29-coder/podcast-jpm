import { router } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { MiniPlayer } from '../../components/MiniPlayer';
import { useActivity, useActivityUpdates } from '../../lib/activity';
import { usePlayer } from '../../lib/player';
import { colors } from '../../theme';

// System tab bar: Liquid Glass on iOS 26, shrinking as you scroll, with the
// now-playing bar docked above it like Apple Podcasts and Music.
export default function TabsLayout() {
  const { episode } = usePlayer();
  useActivityUpdates();
  // New replies, comments, reviews and episodes, counted on the Me tab.
  const { unread } = useActivity();
  return (
    <NativeTabs minimizeBehavior="onScrollDown" tintColor={colors.text} iconColor={{ default: colors.textMuted, selected: colors.text }}>
      {episode && (
        <NativeTabs.BottomAccessory>
          <MiniPlayer />
        </NativeTabs.BottomAccessory>
      )}
      <NativeTabs.Trigger name="(home)" contentStyle={{ backgroundColor: colors.bg }}>
        <NativeTabs.Trigger.Label>Episodes</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'headphones', selected: 'headphones' }} md="podcasts" />
      </NativeTabs.Trigger>
      {/* Full-screen video: it sets its own insets. */}
      <NativeTabs.Trigger name="shorts" disableAutomaticContentInsets contentStyle={{ backgroundColor: '#000' }}>
        <NativeTabs.Trigger.Label>Shorts</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'play.rectangle.on.rectangle', selected: 'play.rectangle.on.rectangle.fill' }} md="smart_display" />
      </NativeTabs.Trigger>
      {/* ＋ opens the camera over everything instead of switching tabs. */}
      <NativeTabs.Trigger
        name="create"
        disabled
        listeners={{ tabPress: () => router.push('/post') }}
        contentStyle={{ backgroundColor: colors.bg }}
      >
        <NativeTabs.Trigger.Label>New</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'plus.circle', selected: 'plus.circle.fill' }} md="add_circle" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(me)" contentStyle={{ backgroundColor: colors.bg }}>
        <NativeTabs.Trigger.Label>Me</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} md="account_circle" />
        {/* No text means no badge; hidden alone still showed "0" on iOS. */}
        <NativeTabs.Trigger.Badge hidden={!unread}>{unread ? String(unread) : undefined}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      {/* iOS 26 shows this as the separate search button at the end of the tab bar. */}
      <NativeTabs.Trigger name="search" role="search" contentStyle={{ backgroundColor: colors.bg }}>
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
