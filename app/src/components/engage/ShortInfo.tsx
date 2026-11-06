import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { Short } from '../../lib/api';
import { formatTime } from '../../lib/format';
import { markShortOpened } from '../../lib/listening';
import { colors, radius, spacing, type } from '../../theme';
import { Icon } from '../Icon';
import { Tags } from './Tags';

// A Short's text over the video, kept small like YouTube Shorts, TikTok and
// Reels: who posted it, the title in at most two lines, and a link to the
// full episode for clips. "more" opens the Description panel with everything
// else (full title, description, tags, counts); the video keeps playing.
export function ShortInfo({ short }: { short: Short }) {
  const [open, setOpen] = useState(false);
  // Who it's from: the person who posted it, else the episode it was cut from.
  const name = short.author?.name ?? short.episodeTitle ?? 'AI Wave';
  const hasMore = !!short.description || short.tags.length > 0 || short.title.length > 60;

  return (
    <View style={{ gap: spacing.xs + 2 }} pointerEvents="box-none">
      <View style={styles.who}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{name.trim().charAt(0).toUpperCase()}</Text>
        </View>
        <Text style={[styles.name, styles.shadowed]} numberOfLines={1}>
          {name}
        </Text>
      </View>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityHint="Shows the description">
        <Text style={[styles.title, styles.shadowed]} numberOfLines={2}>
          {short.title}
        </Text>
      </Pressable>
      <View style={styles.row}>
        {short.episodeId && <EpisodeChip short={short} compact />}
        {hasMore && (
          <Pressable onPress={() => setOpen(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel="More: description">
            <Text style={[styles.more, styles.shadowed]}>more</Text>
          </Pressable>
        )}
      </View>
      <Description short={short} name={name} visible={open} onClose={() => setOpen(false)} />
    </View>
  );
}

// "Full episode" for a Short cut from an episode, starting where the clip is.
function EpisodeChip({ short, compact = false }: { short: Short; compact?: boolean }) {
  const label = compact ? `Full episode${short.startSec != null ? ` · from ${formatTime(short.startSec)}` : ''}` : short.startSec != null ? 'Play full episode from here' : 'Play the full episode';
  return (
    <Pressable
      style={({ pressed }) => [compact ? styles.chip : styles.cta, pressed && { opacity: 0.8 }]}
      onPress={() => {
        markShortOpened(short.id);
        router.push(short.startSec != null ? `/episode/${short.episodeId}?t=${short.startSec}` : `/episode/${short.episodeId}`);
      }}
      accessibilityRole="button"
    >
      <Icon name="headphones" size={compact ? 13 : 16} color={compact ? '#fff' : colors.accentText} />
      <Text style={compact ? styles.chipText : styles.ctaText}>{label}</Text>
    </Pressable>
  );
}

// The Description panel, like YouTube Shorts': slides up over the lower part
// of the screen; tap outside it or Close to go back.
function Description({ short, name, visible, onClose }: { short: Short; name: string; visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Not a tab stop: the browser would draw a focus ring across the video. Close is the focusable way out. */}
      <Pressable style={styles.backdrop} onPress={onClose} focusable={false} accessibilityLabel="Close description" />
      <View style={styles.sheet}>
        <View style={styles.sheetHead}>
          <Text style={type.headline}>Description</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <Icon name="close" size={20} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetBody}>
          <Text style={type.title}>{short.title}</Text>
          <View style={styles.stats}>
            <Stat value={short.likes} label="Likes" />
            <Stat value={short.views} label="Views" />
            <Stat value={short.comments} label="Comments" />
          </View>
          <Text style={type.subhead}>
            {short.author ? `Posted by ${short.author.name}` : short.episodeTitle ? `From “${short.episodeTitle}”` : name}
          </Text>
          {!!short.description && <Text style={[type.body, { color: colors.textMuted }]}>{short.description}</Text>}
          <Tags tags={short.tags} />
          {short.episodeId && <EpisodeChip short={short} />}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={[type.headline, { fontVariant: ['tabular-nums'] }]}>{value}</Text>
      <Text style={type.caption}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  who: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.tintFallback, borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  name: { color: '#fff', fontSize: 14, fontWeight: '700', flexShrink: 1 },
  title: { color: '#fff', fontSize: 16, lineHeight: 21, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' },
  more: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '700' },
  shadowed: { textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs, borderRadius: radius.full, backgroundColor: 'rgba(255,255,255,0.2)' },
  chipText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  cta: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2, borderRadius: radius.full, backgroundColor: colors.accent },
  ctaText: { ...type.footnote, color: colors.accentText, fontWeight: '700' },
  backdrop: { flex: 1 },
  sheet: { maxHeight: '60%', width: '100%', maxWidth: 640, alignSelf: 'center', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, backgroundColor: '#16151C', paddingBottom: spacing.xxl },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  sheetBody: { padding: spacing.lg, gap: spacing.md },
  stats: { flexDirection: 'row', paddingVertical: spacing.sm },
});
