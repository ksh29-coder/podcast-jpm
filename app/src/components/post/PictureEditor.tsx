import { useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View, type GestureResponderEvent, type ViewProps } from 'react-native';
import type { PlacedPicture } from '../../lib/api';
import { formatTime } from '../../lib/format';
import { pickPicture } from '../../lib/pictures';
import { colors, radius, spacing, type } from '../../theme';
import { Icon } from '../Icon';
import { PreviewVideo, type PreviewControls } from './PreviewVideo';

export const MAX_PICTURES = 5;
// How long a new picture shows at first.
const NEW_SEC = 3;
const MIN_SEC = 0.5;

type Props = {
  uri: string;
  // The part of the file that's kept (pictures are timed from its start).
  startSec?: number;
  durationSec: number;
  // Width / height of the video when already known (else read from it).
  aspect?: number | null;
  pictures: PlacedPicture[];
  onChange: (pictures: PlacedPicture[]) => void;
};

// Add pictures to a Short: on top of the video (drag to move, the corner to
// resize) or filling it, each for a stretch of time set on the timeline.
// The video's sound carries on under them. What's shown here is what the
// server draws into the video (backend/src/edit.js).
export function PictureEditor({ uri, startSec = 0, durationSec, aspect: knownAspect, pictures, onChange }: Props) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [aspect, setAspect] = useState<number | null>(knownAspect ?? null);
  const [area, setArea] = useState({ width: 0, height: 0 });
  const [selected, setSelected] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const player = useRef<PreviewControls>(null);
  // Play only the part that's kept, round and round.
  const onTime = (sec: number) => {
    const local = sec - startSec;
    if (local >= durationSec || local < -0.5) player.current?.seekTo(startSec);
    else setT(Math.max(0, local));
  };
  const pause = () => player.current?.pause();

  const seek = (sec: number) => {
    const to = clamp(sec, 0, Math.max(0, durationSec - 0.05));
    player.current?.seekTo(startSec + to);
    setT(to);
  };

  // The video's frame: as big as fits, in its own shape (upright 9:16 until known).
  const a = aspect || 9 / 16;
  const box = area.width / Math.max(1, area.height) > a ? { width: area.height * a, height: area.height } : { width: area.width, height: area.width / a };

  const update = (i: number, patch: Partial<PlacedPicture>) => onChange(pictures.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const add = async (kind: PlacedPicture['kind']) => {
    pause();
    setAdding(true);
    setError(null);
    try {
      const picture = await pickPicture();
      if (!picture) return;
      const start = round(Math.min(t, Math.max(0, durationSec - NEW_SEC)));
      const end = round(Math.min(durationSec, start + NEW_SEC));
      let placed: PlacedPicture = { pictureId: picture.id, kind, startSec: start, endSec: end, picture };
      if (kind === 'overlay') {
        // Half the video's width, in the middle (narrower if it's very tall).
        const tall = (a * picture.height) / picture.width;
        const w = Math.min(0.5, 0.8 / tall);
        placed = { ...placed, w: round(w), x: round((1 - w) / 2), y: round((1 - w * tall) / 2) };
      }
      onChange([...pictures, placed]);
      setSelected(pictures.length);
      seek(start);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };

  const remove = (i: number) => {
    onChange(pictures.filter((_, j) => j !== i));
    setSelected(null);
  };

  const shown = (p: PlacedPicture, i: number) => i === selected || (t >= p.startSec && t < p.endSec);
  const current = selected != null ? pictures[selected] : null;

  return (
    <View style={styles.wrap}>
      <View style={styles.area} onLayout={(e) => setArea(e.nativeEvent.layout)}>
        {area.width > 0 && (
          <View style={[styles.frame, box]}>
            <PreviewVideo
              uri={uri}
              controls={player}
              onTime={onTime}
              onPlaying={setPlaying}
              onAspect={(value) => !knownAspect && setAspect(value)}
              style={StyleSheet.absoluteFill}
            />
            {/* Tapping the video plays or pauses it, and lets go of a picture. */}
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => {
                setSelected(null);
                if (playing) pause();
                else player.current?.play();
              }}
              accessibilityRole="button"
              accessibilityLabel={playing ? 'Pause' : 'Play'}
            />
            {pictures.map((p, i) =>
              !shown(p, i) ? null : p.kind === 'full' ? (
                <Pressable key={i} style={StyleSheet.absoluteFill} onPress={() => setSelected(i)} accessibilityLabel="Full-screen picture">
                  <Image source={{ uri: p.picture.url }} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={30} />
                  <Image source={{ uri: p.picture.url }} style={StyleSheet.absoluteFill} resizeMode="contain" />
                  {i === selected && <View style={[StyleSheet.absoluteFill, styles.selectedFrame]} pointerEvents="none" />}
                </Pressable>
              ) : (
                <OnTop
                  key={i}
                  picture={p}
                  box={box}
                  selected={i === selected}
                  onSelect={() => {
                    setSelected(i);
                    pause();
                  }}
                  onChange={(patch) => update(i, patch)}
                />
              )
            )}
            {!playing && (
              <View style={styles.paused} pointerEvents="none">
                <Icon name="play" size={34} color="#fff" />
              </View>
            )}
          </View>
        )}
      </View>

      <View style={styles.panel}>
        <Timeline
          durationSec={durationSec}
          t={t}
          pictures={pictures}
          selected={selected}
          onSeek={(sec) => {
            pause();
            seek(sec);
          }}
          onSelect={(i) => {
            setSelected(i);
            pause();
            seek(pictures[i].startSec);
          }}
          onTimes={(i, s, e) => {
            update(i, { startSec: s, endSec: e });
            seek(s);
          }}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        {current && selected != null ? (
          <View style={styles.row}>
            <Text style={[type.footnote, styles.grow]}>
              {current.kind === 'full' ? 'Fills the video' : 'On top. Drag it, or its corner to resize.'} {formatTime(current.startSec)}–{formatTime(current.endSec)}
            </Text>
            <Pressable style={styles.chip} onPress={() => remove(selected)} accessibilityRole="button">
              <Icon name="trash" size={16} color={colors.danger} />
              <Text style={[styles.chipText, { color: colors.danger }]}>Remove</Text>
            </Pressable>
            <Pressable style={styles.chip} onPress={() => setSelected(null)} accessibilityRole="button">
              <Text style={styles.chipText}>Done</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.row}>
            {adding ? (
              <View style={[styles.row, styles.grow]}>
                <ActivityIndicator color={colors.highlight} />
                <Text style={type.subhead}>Adding the picture…</Text>
              </View>
            ) : pictures.length >= MAX_PICTURES ? (
              <Text style={[type.footnote, styles.grow]}>That’s the most pictures a Short can have ({MAX_PICTURES}).</Text>
            ) : (
              <>
                <Pressable style={[styles.chip, styles.grow]} onPress={() => add('overlay')} accessibilityRole="button">
                  <Icon name="photo" size={16} />
                  <Text style={styles.chipText}>Picture on top</Text>
                </Pressable>
                <Pressable style={[styles.chip, styles.grow]} onPress={() => add('full')} accessibilityRole="button">
                  <Icon name="expand" size={16} />
                  <Text style={styles.chipText}>Full-screen picture</Text>
                </Pressable>
              </>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

// A picture on top of the video: drag to move it, its corner to resize.
function OnTop({
  picture: p,
  box,
  selected,
  onSelect,
  onChange,
}: {
  picture: PlacedPicture;
  box: { width: number; height: number };
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<PlacedPicture>) => void;
}) {
  const w = p.w ?? 0.5;
  const width = w * box.width;
  const height = (width * p.picture.height) / p.picture.width;
  // The drag in progress: which part, and where things were when it started.
  const [drag, setDrag] = useState<{ pageX: number; pageY: number; x: number; y: number; w: number } | null>(null);
  // Half of it may hang off any edge.
  const hFrac = height / box.height;
  const handlers = (part: 'move' | 'resize'): ViewProps => ({
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: GestureResponderEvent) => {
      setDrag({ pageX: e.nativeEvent.pageX, pageY: e.nativeEvent.pageY, x: p.x ?? 0, y: p.y ?? 0, w });
      onSelect();
    },
    onResponderMove: (e: GestureResponderEvent) => {
      if (!drag) return;
      const dx = (e.nativeEvent.pageX - drag.pageX) / box.width;
      const dy = (e.nativeEvent.pageY - drag.pageY) / box.height;
      if (part === 'resize') onChange({ w: round(clamp(drag.w + dx, 0.1, 1)) });
      else
        onChange({
          x: round(clamp(drag.x + dx, -w / 2, 1 - w / 2)),
          y: round(clamp(drag.y + dy, Math.max(-0.5, -hFrac / 2), 1 - hFrac / 2)),
        });
    },
    onResponderRelease: () => setDrag(null),
  });
  const moveIt = handlers('move');
  const resize = handlers('resize');

  return (
    <View
      {...moveIt}
      style={[styles.onTop, { left: (p.x ?? 0) * box.width, top: (p.y ?? 0) * box.height, width, height }, selected && styles.selectedFrame]}
      accessibilityLabel="Picture on top. Drag to move it."
    >
      <Image source={{ uri: p.picture.url }} style={StyleSheet.absoluteFill} resizeMode="stretch" />
      {selected && (
        <View {...resize} style={styles.corner} hitSlop={12} accessibilityLabel="Resize the picture">
          <View style={styles.cornerDot} />
        </View>
      )}
    </View>
  );
}

// The video's timeline (tap or drag to move through it) and a bar for each
// picture: drag its ends to change when it shows, or the middle to move it.
function Timeline({
  durationSec,
  t,
  pictures,
  selected,
  onSeek,
  onSelect,
  onTimes,
}: {
  durationSec: number;
  t: number;
  pictures: PlacedPicture[];
  selected: number | null;
  onSeek: (sec: number) => void;
  onSelect: (i: number) => void;
  onTimes: (i: number, startSec: number, endSec: number) => void;
}) {
  const [width, setWidth] = useState(0);
  const start = useRef({ pageX: 0, s: 0, e: 0 });
  const x = (sec: number) => (durationSec > 0 ? (sec / durationSec) * width : 0);
  const secAt = (locationX: number) => clamp((locationX / Math.max(1, width)) * durationSec, 0, durationSec);

  const scrub: ViewProps = {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderGrant: (e) => onSeek(secAt(e.nativeEvent.locationX)),
    onResponderMove: (e) => onSeek(secAt(e.nativeEvent.locationX)),
  };

  const barDrag = (i: number, part: 'start' | 'end' | 'middle'): ViewProps => ({
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e) => {
      start.current = { pageX: e.nativeEvent.pageX, s: pictures[i].startSec, e: pictures[i].endSec };
      if (i !== selected) onSelect(i);
    },
    onResponderMove: (e) => {
      const delta = ((e.nativeEvent.pageX - start.current.pageX) / Math.max(1, width)) * durationSec;
      let { s, e: end } = start.current;
      if (part === 'start') s = clamp(s + delta, 0, end - MIN_SEC);
      else if (part === 'end') end = clamp(end + delta, s + MIN_SEC, durationSec);
      else {
        const len = end - s;
        s = clamp(s + delta, 0, durationSec - len);
        end = s + len;
      }
      onTimes(i, round(s), round(end));
    },
  });

  return (
    <View style={styles.timeline}>
      <View style={styles.times}>
        <Text style={styles.time}>{formatTime(t)}</Text>
        <Text style={styles.time}>{formatTime(durationSec)}</Text>
      </View>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <View {...scrub} style={styles.scrub} accessibilityLabel="Timeline. Drag to move through the video.">
          <View style={[styles.played, { width: x(t) }]} pointerEvents="none" />
        </View>
        {pictures.map((p, i) => {
          const on = i === selected;
          const left = x(p.startSec);
          const barWidth = Math.max(16, x(p.endSec) - left);
          return (
            <View key={i} style={styles.track}>
              <View {...barDrag(i, 'middle')} style={[styles.bar, on && styles.barOn, { left, width: barWidth }]} accessibilityLabel={`Picture ${i + 1}, ${formatTime(p.startSec)} to ${formatTime(p.endSec)}`}>
                <Image source={{ uri: p.picture.url }} style={styles.barThumb} />
                <Icon name={p.kind === 'full' ? 'expand' : 'photo'} size={12} color={on ? colors.accentText : colors.text} />
              </View>
              {on && (
                <>
                  <View {...barDrag(i, 'start')} style={[styles.end, { left: left - 11 }]} hitSlop={8} accessibilityLabel="When it starts">
                    <View style={styles.endDot} />
                  </View>
                  <View {...barDrag(i, 'end')} style={[styles.end, { left: left + barWidth - 11 }]} hitSlop={8} accessibilityLabel="When it ends">
                    <View style={styles.endDot} />
                  </View>
                </>
              )}
            </View>
          );
        })}
        <View style={[styles.playhead, { left: x(t) - 1 }]} pointerEvents="none" />
      </View>
    </View>
  );
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round = (n: number) => Math.round(n * 1000) / 1000;

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: spacing.md },
  area: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frame: { overflow: 'hidden', backgroundColor: '#000', borderRadius: radius.md },
  onTop: { position: 'absolute' },
  selectedFrame: { borderWidth: 2, borderColor: colors.highlight },
  corner: { position: 'absolute', right: -12, bottom: -12, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  cornerDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.highlight, borderWidth: 2, borderColor: '#000' },
  paused: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  panel: { gap: spacing.md, paddingHorizontal: spacing.lg },
  timeline: { gap: spacing.xs },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { ...type.caption, color: 'rgba(255,255,255,0.8)', fontVariant: ['tabular-nums'] },
  scrub: { height: 24, borderRadius: radius.sm, backgroundColor: 'rgba(255,255,255,0.18)', overflow: 'hidden' },
  played: { height: '100%', backgroundColor: 'rgba(255,255,255,0.35)' },
  track: { height: 30, marginTop: spacing.xs },
  bar: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.22)',
    overflow: 'hidden',
  },
  barOn: { backgroundColor: colors.highlight },
  barThumb: { width: 22, height: 22, borderRadius: 4, backgroundColor: '#000' },
  end: { position: 'absolute', top: -2, bottom: -2, width: 22, alignItems: 'center', justifyContent: 'center' },
  endDot: { width: 8, height: '100%', borderRadius: 4, backgroundColor: '#fff' },
  playhead: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  chipText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  error: { color: colors.danger, fontSize: 14 },
});
