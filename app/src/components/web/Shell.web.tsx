import type { ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { formatTime } from '../../lib/format';
import { usePlayer } from '../../lib/player';
import { colors, radius, spacing, type } from '../../theme';
import { Icon, skipIcon, type IconName } from '../Icon';
import { hovered } from './hover';

// The website's frame around every page: a sidebar on wide screens (like
// YouTube or Spotify on the web) or a bottom bar on narrow ones, the
// now-playing bar, and a Back button on pages opened from another page.
// Host Studio and the posting screens have their own frames.
const WIDE = 900;

type Tab = { href: '/' | '/shorts' | '/search' | '/create' | '/me'; label: string; icon: IconName; match: (p: string) => boolean };
const TABS: Tab[] = [
  { href: '/', label: 'Home', icon: 'home', match: (p) => p === '/' },
  { href: '/shorts', label: 'Shorts', icon: 'shorts', match: (p) => p.startsWith('/shorts') },
  { href: '/search', label: 'Search', icon: 'search', match: (p) => p.startsWith('/search') },
  { href: '/create', label: 'New', icon: 'plus', match: (p) => p.startsWith('/create') },
  { href: '/me', label: 'Me', icon: 'person', match: (p) => p === '/me' || p.startsWith('/downloads') || p.startsWith('/my-short') },
];

// Pages opened on top of a tab, which get a Back button.
const DETAIL = /^\/(episode|comments|transcript|playback|privacy)(\/|$)/;

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { width } = useWindowDimensions();
  // Host Studio, the posting screens and the voice assistant have their own frames. The structure
  // here stays the same either way: changing it would remount the pages and
  // lose where the visitor is.
  const bare = path.startsWith('/host') || path.startsWith('/post') || path.startsWith('/assistant');
  const wide = width >= WIDE;
  return (
    <View style={[styles.root, { flexDirection: wide ? 'row' : 'column' }]}>
      {wide && !bare && <Sidebar path={path} />}
      <View style={styles.main}>
        {!bare && DETAIL.test(path) && (
          <View style={styles.topBar}>
            <Pressable
              onPress={() => (router.canGoBack() ? router.back() : router.navigate('/'))}
              style={(s) => [styles.back, hovered(s) && { backgroundColor: colors.card }]}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Icon name="chevronLeft" size={18} />
              <Text style={type.subhead}>Back</Text>
            </Pressable>
          </View>
        )}
        <View style={{ flex: 1 }}>{children}</View>
        {!bare && <PlayerBar />}
      </View>
      {!wide && !bare && (
        <View style={styles.bottomBar}>
          {TABS.map((t) => {
            const on = t.match(path);
            return (
              <Pressable key={t.href} onPress={() => router.navigate(t.href)} style={styles.bottomItem} accessibilityRole="link" accessibilityState={{ selected: on }}>
                <Icon name={t.icon} size={22} color={on ? colors.text : colors.textMuted} />
                <Text style={[type.caption, { color: on ? colors.text : colors.textMuted, fontWeight: '700' }]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

function Sidebar({ path }: { path: string }) {
  return (
    <View style={styles.sidebar}>
      <Pressable onPress={() => router.navigate('/')} style={styles.brand} accessibilityRole="link" accessibilityLabel="AI Dev Wave home">
        <Logo />
        <Text style={styles.brandText}>AI Dev Wave</Text>
      </Pressable>
      <Pressable onPress={() => router.navigate('/create')} style={(s) => [styles.newButton, hovered(s) && { opacity: 0.88 }]} accessibilityRole="link">
        <Icon name="plus" size={18} color={colors.accentText} />
        <Text style={styles.newText}>New</Text>
      </Pressable>
      <View style={{ gap: 2 }}>
        {TABS.filter((t) => t.href !== '/create').map((t) => {
          const on = t.match(path);
          return (
            <Pressable
              key={t.href}
              onPress={() => router.navigate(t.href)}
              style={(s) => [styles.item, hovered(s) && styles.itemHover, on && styles.itemActive]}
              accessibilityRole="link"
              accessibilityState={{ selected: on }}
            >
              <Icon name={t.icon} size={20} color={on ? colors.text : colors.textMuted} />
              <Text style={[styles.itemText, !on && { color: colors.textMuted }]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.divider} />
      <Pressable style={(s) => [styles.item, hovered(s) && styles.itemHover]} onPress={() => router.push('/host')} accessibilityRole="link">
        <Icon name="shield" size={20} color={colors.textMuted} />
        <Text style={[styles.itemText, { color: colors.textMuted }]}>Host Studio</Text>
      </Pressable>
    </View>
  );
}

// The app icon's waveform, small.
function Logo() {
  const bars = [0.37, 0.74, 1, 0.63, 0.43];
  return (
    <View style={styles.logo}>
      {bars.map((h, i) => (
        <View key={i} style={{ width: 3, height: 18 * h, borderRadius: 2, backgroundColor: i === 2 ? colors.highlight : colors.text }} />
      ))}
    </View>
  );
}

// Now playing, along the bottom of the page while an episode plays.
function PlayerBar() {
  const { episode, status, togglePlay, seekBy, prefs } = usePlayer();
  if (!episode) return null;
  const fraction = status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;
  return (
    <View style={styles.player}>
      <View style={styles.playerTrack}>
        <View style={[styles.playerFill, { width: `${fraction * 100}%` }]} />
      </View>
      <View style={styles.playerRow}>
        <Pressable style={styles.playerInfo} onPress={() => router.push(`/episode/${episode.id}`)} accessibilityRole="link">
          <Image source={{ uri: episode.artworkUrl }} style={styles.playerArt} />
          <View style={{ flex: 1 }}>
            <Text style={type.headline} numberOfLines={1}>
              {episode.title}
            </Text>
            <Text style={[type.caption, { fontVariant: ['tabular-nums'] }]}>
              {formatTime(status.currentTime)} / {formatTime(status.duration || episode.durationSec)}
            </Text>
          </View>
        </Pressable>
        <View style={styles.playerControls}>
          <Pressable onPress={() => seekBy(-prefs.skipBack)} accessibilityRole="button" accessibilityLabel={`Back ${prefs.skipBack} seconds`}>
            <Icon name={skipIcon('back', prefs.skipBack)} size={22} />
          </Pressable>
          <Pressable onPress={togglePlay} style={styles.playerPlay} accessibilityRole="button" accessibilityLabel={status.playing ? 'Pause' : 'Play'}>
            <Icon name={status.playing ? 'pause' : 'play'} size={18} color={colors.accentText} />
          </Pressable>
          <Pressable onPress={() => seekBy(prefs.skipForward)} accessibilityRole="button" accessibilityLabel={`Forward ${prefs.skipForward} seconds`}>
            <Icon name={skipIcon('forward', prefs.skipForward)} size={22} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  main: { flex: 1, minWidth: 0 },
  topBar: { paddingHorizontal: spacing.xxxl, paddingTop: spacing.lg },
  back: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border },
  sidebar: { width: 232, paddingHorizontal: spacing.md, paddingVertical: spacing.xl, gap: spacing.lg, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border, backgroundColor: '#0D0C12' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
  brandText: { ...type.headline, fontWeight: '800' },
  logo: { width: 30, height: 30, borderRadius: 8, backgroundColor: colors.tintFallback, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
  newButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.sm + 2, borderRadius: radius.full, backgroundColor: colors.accent },
  newText: { color: colors.accentText, fontWeight: '800', fontSize: 15 },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, borderRadius: radius.md },
  itemHover: { backgroundColor: colors.card },
  itemActive: { backgroundColor: colors.cardHigh },
  itemText: { ...type.subhead, color: colors.text, fontWeight: '700' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginHorizontal: spacing.sm },
  bottomBar: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: '#0D0C12' },
  bottomItem: { alignItems: 'center', gap: 2, paddingHorizontal: spacing.md },
  player: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: '#0D0C12' },
  playerTrack: { height: 3, backgroundColor: colors.border },
  playerFill: { height: 3, backgroundColor: colors.highlight },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm },
  playerInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, minWidth: 0 },
  playerArt: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.cardHigh },
  playerControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  playerPlay: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
});
