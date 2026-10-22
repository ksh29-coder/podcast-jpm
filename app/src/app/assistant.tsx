import { useEffect, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVoiceAssistant, type AssistantState, type Card } from '../components/assistant/useVoiceAssistant';
import { loadVoice, saveVoice, VOICES } from '../components/assistant/voices';
import { Icon } from '../components/Icon';
import { formatTime } from '../lib/format';
import { colors, radius, spacing, type } from '../theme';

const LABEL: Record<AssistantState, string> = {
  connecting: 'Connecting…',
  listening: 'Listening',
  thinking: 'Thinking…',
  speaking: 'Speaking',
  ended: 'Conversation ended',
  error: 'Couldn’t start',
};

// The voice assistant, opened from the mic in Search: talk about what's on
// AI Dev Wave, and what it finds appears as cards to open.
export default function AssistantScreen() {
  const [voice, setVoice] = useState<string | null>(null);
  useEffect(() => {
    loadVoice().then(setVoice);
  }, []);
  if (!voice) return <ActivityIndicator style={{ flex: 1, backgroundColor: colors.bg }} color={colors.text} />;
  // A new voice starts a new conversation, so it's heard straight away.
  return (
    <Conversation
      key={voice}
      voice={voice}
      onVoice={(v) => {
        saveVoice(v);
        setVoice(v);
      }}
    />
  );
}

function Conversation({ voice, onVoice }: { voice: string; onVoice: (v: string) => void }) {
  const insets = useSafeAreaInsets();
  const { state, error, cards, left, stop } = useVoiceAssistant(voice);

  const close = () => {
    stop();
    if (router.canGoBack()) router.back();
    else router.replace('/search');
  };
  // Opening something ends the conversation (its sound would clash).
  const open = (card: Card) => {
    stop();
    router.back();
    if (card.kind === 'episode') router.push(`/episode/${card.id}`);
    else if (card.kind === 'moment') router.push(`/episode/${card.id}?t=${Math.round(card.startSec)}`);
    else router.push(process.env.EXPO_OS === 'web' ? `/shorts?id=${card.id}` : '/shorts');
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.top}>
        <Pressable onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
          <Icon name="close" size={22} />
        </Pressable>
        <Text style={[type.footnote, { fontVariant: ['tabular-nums'] }]}>{left != null && state !== 'ended' && state !== 'error' ? `${formatTime(left)} left` : ''}</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.voices}>
        <Text style={[type.eyebrow, { alignSelf: 'center' }]}>Voice</Text>
        {VOICES.map((v) => {
          const on = v.id === voice;
          return (
            <Pressable
              key={v.id}
              onPress={() => !on && onVoice(v.id)}
              style={[styles.voice, on && styles.voiceOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Voice ${v.label}`}
            >
              <Text style={[styles.voiceText, on && { color: colors.accentText }]}>{v.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.center}>
        <Orb state={state} />
        <Text style={type.title}>{LABEL[state]}</Text>
        {state === 'error' && <Text style={[type.subhead, styles.note, { color: colors.danger }]}>{error}</Text>}
        {(state === 'connecting' || state === 'thinking') && cards.length === 0 && (
          <Text style={[type.subhead, styles.note]}>Ask about anything on AI Dev Wave, like “what do we have on testing?”</Text>
        )}
        {state === 'ended' && <Text style={[type.subhead, styles.note]}>Ask again any time from Search.</Text>}
      </View>

      {cards.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cards} style={{ flexGrow: 0 }}>
          {cards.map((c) => (
            <CardView key={`${c.kind}-${c.id}-${c.kind === 'moment' ? c.startSec : ''}`} card={c} onPress={() => open(c)} />
          ))}
        </ScrollView>
      )}

      <Pressable
        style={[styles.end, (state === 'ended' || state === 'error') && styles.endDone]}
        onPress={state === 'ended' || state === 'error' ? close : stop}
        accessibilityRole="button"
      >
        <Text style={[styles.endText, (state === 'ended' || state === 'error') && { color: colors.accentText }]}>
          {state === 'ended' || state === 'error' ? 'Done' : 'End'}
        </Text>
      </Pressable>
    </View>
  );
}

// The app icon's waveform, moving with the conversation: a slow breath while
// listening, quick bars while speaking, a gentle shimmer while thinking.
function Orb({ state }: { state: AssistantState }) {
  const bars = [0.37, 0.74, 1, 0.63, 0.43];
  const [anims] = useState(() => bars.map(() => new Animated.Value(1)));
  useEffect(() => {
    const live = state === 'listening' || state === 'speaking' || state === 'thinking' || state === 'connecting';
    if (!live) {
      anims.forEach((a) => a.setValue(0.6));
      return;
    }
    const speed = state === 'speaking' ? 260 : state === 'listening' ? 700 : 450;
    const depth = state === 'speaking' ? 0.45 : 0.2;
    const loops = anims.map((a, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * (speed / 5)),
          Animated.timing(a, { toValue: 1 - depth, duration: speed, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(a, { toValue: 1, duration: speed, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [state, anims]);

  return (
    <View style={[styles.orb, state === 'speaking' && styles.orbSpeaking]}>
      {bars.map((h, i) => (
        <Animated.View key={i} style={[styles.bar, { height: 120 * h, backgroundColor: i === 2 ? colors.highlight : colors.text, transform: [{ scaleY: anims[i] }] }]} />
      ))}
    </View>
  );
}

function CardView({ card, onPress }: { card: Card; onPress: () => void }) {
  if (card.kind === 'moment') {
    return (
      <Pressable style={[styles.card, styles.moment]} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${card.episodeTitle}, ${formatTime(card.startSec)} in`}>
        <Text style={[type.caption, { color: colors.highlight }]} numberOfLines={1}>
          {card.episodeTitle} · {formatTime(card.startSec)}
        </Text>
        <Text style={type.subhead} numberOfLines={4}>
          “{card.said}”
        </Text>
      </Pressable>
    );
  }
  return (
    <Pressable style={styles.card} onPress={onPress} accessibilityRole="button" accessibilityLabel={card.title}>
      {card.artworkUrl ? <Image source={{ uri: card.artworkUrl }} style={card.kind === 'short' ? styles.artShort : styles.art} /> : <View style={styles.art} />}
      <Text style={type.headline} numberOfLines={2}>
        {card.title}
      </Text>
      <Text style={type.caption} numberOfLines={1}>
        {[card.kind === 'short' ? 'Short' : card.minutes ? `${card.minutes} min` : 'Episode', card.by].filter(Boolean).join(' · ')}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.xl, gap: spacing.lg },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  note: { textAlign: 'center', maxWidth: 360 },
  orb: { width: 220, height: 220, borderRadius: 110, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.tintFallback },
  orbSpeaking: { boxShadow: `0 0 80px rgba(255,181,71,0.35)` },
  bar: { width: 16, borderRadius: 8 },
  cards: { gap: spacing.md, paddingVertical: spacing.xs },
  voices: { gap: spacing.sm, alignItems: 'center', marginHorizontal: 'auto' },
  voice: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.full, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  voiceOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  voiceText: { color: colors.text, fontWeight: '700', fontSize: 13 },
  card: { width: 160, gap: spacing.xs, padding: spacing.sm, borderRadius: radius.lg, backgroundColor: colors.card },
  moment: { width: 220, padding: spacing.md, gap: spacing.sm },
  art: { width: 144, height: 144, borderRadius: radius.md, backgroundColor: colors.cardHigh },
  artShort: { width: 144, height: 180, borderRadius: radius.md, backgroundColor: colors.cardHigh },
  end: { alignSelf: 'center', paddingHorizontal: spacing.huge, paddingVertical: spacing.md + 2, borderRadius: radius.full, backgroundColor: colors.danger },
  endDone: { backgroundColor: colors.accent },
  endText: { color: '#fff', fontWeight: '800', fontSize: 17 },
});
