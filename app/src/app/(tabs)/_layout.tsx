import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { MiniPlayer } from '../../components/MiniPlayer';
import { usePlayer } from '../../lib/player';
import { colors } from '../../theme';

// System tab bar: Liquid Glass on iOS 26, shrinking as you scroll, with the
// now-playing bar docked above it like Apple Podcasts and Music.
export default function TabsLayout() {
  const { episode } = usePlayer();
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
      <NativeTabs.Trigger name="(downloads)" contentStyle={{ backgroundColor: colors.bg }}>
        <NativeTabs.Trigger.Label>Downloads</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'arrow.down.circle', selected: 'arrow.down.circle.fill' }} md="download" />
      </NativeTabs.Trigger>
      {/* iOS 26 shows this as the separate search button at the end of the tab bar. */}
      <NativeTabs.Trigger name="search" role="search" contentStyle={{ backgroundColor: colors.bg }}>
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
