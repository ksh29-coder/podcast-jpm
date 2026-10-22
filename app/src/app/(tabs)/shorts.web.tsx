import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ErrorState } from '../../components/ErrorState';
import { Icon, type IconName } from '../../components/Icon';
import { Scrubber } from '../../components/Scrubber';
import { ShortVideo, type ShortVideoHandle } from '../../components/ShortVideo';
import { shareItem } from '../../components/engage/share';
import { ShortInfo } from '../../components/engage/ShortInfo';
import { PostMenu } from '../../components/engage/PostMenu';
import { useLike } from '../../components/engage/useLike';
import { hovered } from '../../components/web/hover';
import { api, type Short } from '../../lib/api';
import { isBlocked, useBlocked } from '../../lib/blocked';
import { usePlayer } from '../../lib/player';
import { useFetch } from '../../lib/useFetch';
import { colors, radius, spacing, type } from '../../theme';

// The website's Shorts: one vertical video at a time in the middle of the
// page, with the actions beside it and up/down to move between Shorts
// (buttons, arrow keys, or the mouse wheel), like YouTube Shorts on a computer.
export default function ShortsWeb() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { data: all, error, reload } = useFetch(api.shorts);
  // Without anything from people this person hid.
  const blocked = useBlocked();
  const data = all && all.filter((s) => !isBlocked(blocked, s));
  const [index, setIndex] = useState<number | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const { pause } = usePlayer();

  // Shorts have their own sound, so pause any episode.
  useEffect(() => {
    pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const count = data?.length ?? 0;
  const current = data ? (index ?? Math.max(0, data.findIndex((s) => s.id === id))) : 0;
  const go = (delta: number) => setIndex(Math.min(count - 1, Math.max(0, current + delta)));

  // Arrow keys and the mouse wheel, with a short pause between wheel moves.
  const wheelAt = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowDown' || e.key === 'j') go(1);
      else if (e.key === 'ArrowUp' || e.key === 'k') go(-1);
      else return;
      e.preventDefault();
    };
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) < 30 || Date.now() - wheelAt.current < 700) return;
      wheelAt.current = Date.now();
      go(e.deltaY > 0 ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onWheel);
    };
  });

  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <ActivityIndicator style={{ flex: 1, backgroundColor: colors.bg }} color={colors.text} />;
  if (!data.length) {
    return (
      <View style={styles.empty}>
        <Text style={type.subhead}>No Shorts yet. Post one with New.</Text>
      </View>
    );
  }

  // Narrow windows (a phone's browser): the video fills the page and the
  // buttons sit on it, like the app.
  const narrow = box.w > 0 && box.w < 700;
  return (
    <View style={styles.screen} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {box.h > 0 && <ShortStage key={data[current].id} short={data[current]} index={current} total={count} box={box} narrow={narrow} />}
      <View style={narrow ? styles.navNarrow : styles.nav}>
        <NavButton icon="chevronUp" label="Previous Short" disabled={current === 0} onPress={() => go(-1)} />
        <NavButton icon="chevronDown" label="Next Short" disabled={current >= count - 1} onPress={() => go(1)} />
      </View>
    </View>
  );
}

function ShortStage({ short, index, total, box, narrow }: { short: Short; index: number; total: number; box: { w: number; h: number }; narrow: boolean }) {
  const [paused, setPaused] = useState(false);
  const [time, setTime] = useState({ position: 0, duration: 0 });
  const video = useRef<ShortVideoHandle>(null);
  const actions = <Actions short={short} narrow={narrow} />;
  const h = narrow ? box.h : Math.max(420, box.h - spacing.xxxl * 2);
  const w = narrow ? box.w : Math.min((h * 9) / 16, box.w - 200);

  // Counts as a view after two seconds (the server counts each person once).
  useEffect(() => {
    const t = setTimeout(() => api.view('short', short.id).catch(() => {}), 2000);
    return () => clearTimeout(t);
  }, [short.id]);

  return (
    <View style={styles.stage}>
      <View style={[styles.player, { width: w, height: h }, narrow && { borderRadius: 0 }]}>
        <ShortVideo ref={video} uri={short.videoUrl} playing={!paused} style={StyleSheet.absoluteFill} focusX={short.focusX} onTime={(position, duration) => setTime({ position, duration })} />
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setPaused((p) => !p)} accessibilityRole="button" accessibilityLabel={paused ? 'Play' : 'Pause'}>
          {paused && (
            <View style={styles.paused}>
              <Icon name="play" size={64} color="rgba(255,255,255,0.85)" />
            </View>
          )}
        </Pressable>
        <View pointerEvents="box-none" style={[styles.overlay, narrow && { paddingRight: 76 }]}>
          <ShortInfo short={short} />
          {time.duration > 0 && <Scrubber variant="overlay" position={time.position} duration={time.duration} onSeek={(sec) => video.current?.seekTo(sec)} />}
        </View>
        <Text style={styles.counter}>
          {index + 1} / {total}
        </Text>
        {narrow && actions}
      </View>
      {!narrow && actions}
    </View>
  );
}

function Actions({ short, narrow }: { short: Short; narrow: boolean }) {
  const like = useLike('short', short.id, short);
  const [menu, setMenu] = useState(false);
  return (
    <View style={narrow ? styles.actionsNarrow : styles.actions}>
      <Action icon={like.liked ? 'heartFill' : 'heart'} color={like.liked ? colors.liked : colors.text} label={String(like.likes)} a11y={like.liked ? 'Unlike' : 'Like'} onPress={like.toggle} />
      <Action icon="comment" label={String(short.comments)} a11y="Comments" onPress={() => router.push(`/comments/short/${short.id}`)} />
      <Action icon="share" label="Share" a11y="Share" onPress={() => shareItem({ title: short.title, path: `/shorts?id=${short.id}` })} />
      <Action icon="eye" label={String(short.views)} a11y={`${short.views} views`} />
      <Action icon="more" label="" a11y="More: report or hide" onPress={() => setMenu(true)} />
      <PostMenu visible={menu} onClose={() => setMenu(false)} itemType="short" id={short.id} author={short.author} />
    </View>
  );
}

function Action({ icon, label, a11y, onPress, color = colors.text }: { icon: IconName; label: string; a11y: string; onPress?: () => void; color?: string }) {
  return (
    <Pressable style={styles.action} onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : 'text'} accessibilityLabel={a11y}>
      {(s) => (
        <>
          <View style={[styles.actionCircle, hovered(s) && !!onPress && { backgroundColor: colors.border }]}>
            <Icon name={icon} size={24} color={color} />
          </View>
          <Text style={styles.actionLabel}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

function NavButton({ icon, label, disabled, onPress }: { icon: IconName; label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={(s) => [styles.navButton, hovered(s) && { backgroundColor: colors.border }, disabled && { opacity: 0.3 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name={icon} size={24} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  stage: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.lg },
  player: { borderRadius: radius.xl, overflow: 'hidden', backgroundColor: '#000' },
  paused: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.lg,
    gap: spacing.sm,
    experimental_backgroundImage: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.75) 45%)',
  },
  counter: { position: 'absolute', top: spacing.md, right: spacing.md, ...type.caption, color: 'rgba(255,255,255,0.85)', fontVariant: ['tabular-nums'] },
  actions: { gap: spacing.lg, paddingBottom: spacing.lg },
  actionsNarrow: { position: 'absolute', right: spacing.md, bottom: 140, gap: spacing.md },
  action: { alignItems: 'center', gap: spacing.xs },
  actionCircle: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.cardHigh, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { ...type.caption, color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  nav: { position: 'absolute', right: spacing.xxxl, top: 0, bottom: 0, justifyContent: 'center', gap: spacing.md },
  navNarrow: { position: 'absolute', right: spacing.md, top: 44, gap: spacing.sm },
  navButton: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.cardHigh, alignItems: 'center', justifyContent: 'center' },
});
