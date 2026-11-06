import { memo, useEffect, useMemo, useRef } from 'react';
import type { EpisodeEdit } from '../../../lib/host';
import { clock, cutState, type Range } from '../../../lib/edit';
import { colors } from '../../../theme';

type Word = { text: string; from: number; to: number; index: number };
type Line = { from: number; to: number; text: string; speaker: string | null; words: Word[] };

// What was said, in the original's times: click a word (or a line, when the
// transcript has no word times) to jump there; drag across words to select
// them for cutting. Cut parts are struck through.
export function Transcript({ transcript, segments, now, selection, onSeek, onSelect }: {
  transcript: EpisodeEdit['transcript'];
  segments: Range[];
  now: number;
  selection: Range | null;
  onSeek: (t: number) => void;
  onSelect: (range: Range | null) => void;
}) {
  const lines = useMemo(() => toLines(transcript), [transcript]);
  const drag = useRef<{ anchor: Word; moved: boolean } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const activeLine = lines.findIndex((l) => now >= l.from && now < l.to);

  // Keep the line being played in view.
  useEffect(() => {
    if (activeLine < 0 || drag.current) return;
    scroller.current?.querySelector(`[data-line="${activeLine}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeLine]);

  useEffect(() => {
    const up = () => {
      drag.current = null;
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const press = (w: Word, shift: boolean) => {
    if (shift && selection) return onSelect({ from: Math.min(selection.from, w.from), to: Math.max(selection.to, w.to) });
    drag.current = { anchor: w, moved: false };
  };
  const enter = (w: Word) => {
    const d = drag.current;
    if (!d) return;
    d.moved = true;
    const [a, b] = d.anchor.index <= w.index ? [d.anchor, w] : [w, d.anchor];
    onSelect({ from: a.from, to: b.to });
  };
  const release = (w: Word) => {
    if (drag.current && !drag.current.moved) {
      onSelect(null);
      onSeek(w.from);
    }
    drag.current = null;
  };

  if (!lines.length) {
    return <p style={{ color: colors.textMuted, fontSize: 14, margin: 0, fontFamily: FONT }}>{TRANSCRIPT_STATUS[transcript.status] ?? 'No transcript yet.'}</p>;
  }
  return (
    <div ref={scroller} style={{ overflowY: 'auto', height: '100%', paddingRight: 6, userSelect: 'none', fontFamily: FONT }}>
      {!transcript.words && (
        <p style={{ color: colors.textMuted, fontSize: 12, marginTop: 0 }}>This transcript has times for lines, not words. Transcribe it again from the episode page to cut word by word.</p>
      )}
      {lines.map((line, i) => (
        <LineView
          key={i}
          index={i}
          line={line}
          showSpeaker={!!line.speaker && line.speaker !== lines[i - 1]?.speaker}
          segments={segments}
          activeWord={i === activeLine ? (line.words.find((w) => now >= w.from && now < w.to)?.index ?? -1) : -2}
          selection={selection && selection.from < line.to && selection.to > line.from ? selection : null}
          onPress={press}
          onEnter={enter}
          onRelease={release}
        />
      ))}
    </div>
  );
}

// The same type as the rest of the page (React Native Web's).
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const TRANSCRIPT_STATUS: Record<string, string> = {
  none: 'No transcript yet. Transcribe the episode from its page to edit by what was said.',
  generating: 'The transcript is being made. Come back in a few minutes.',
  unavailable: 'This video has no speech to transcribe.',
};

// Lines with their words (each line's words are the ones said in its time).
function toLines(t: EpisodeEdit['transcript']): Line[] {
  const all: Word[] = (t.words ?? []).map(([text, from, to], index) => ({ text, from, to, index }));
  let w = 0;
  let index = all.length;
  return t.lines.map((l) => {
    const words: Word[] = [];
    while (w < all.length && all[w].from < l.endSec - 0.005) {
      if (all[w].from >= l.startSec - 0.05) words.push(all[w]);
      w++;
    }
    const speaker = l.speaker === null ? null : (t.speakers[l.speaker] ?? `Speaker ${l.speaker + 1}`);
    // Without word times, the line is one "word".
    return { from: l.startSec, to: l.endSec, text: l.text, speaker, words: words.length ? words : [{ text: l.text, from: l.startSec, to: l.endSec, index: index++ }] };
  });
}

const LineView = memo(function LineView({ index, line, showSpeaker, segments, activeWord, selection, onPress, onEnter, onRelease }: {
  index: number;
  line: Line;
  showSpeaker: boolean;
  segments: Range[];
  activeWord: number;
  selection: Range | null;
  onPress: (w: Word, shift: boolean) => void;
  onEnter: (w: Word) => void;
  onRelease: (w: Word) => void;
}) {
  return (
    <div data-line={index} style={{ marginBottom: 8, fontSize: 15, lineHeight: 1.6, color: colors.text }}>
      {showSpeaker && <div style={{ color: colors.highlight, fontSize: 12, fontWeight: 700, marginTop: 6 }}>{line.speaker}</div>}
      <span style={{ color: colors.textFaint, fontSize: 11, marginRight: 6, fontVariantNumeric: 'tabular-nums' }}>{clock(line.from)}</span>
      {line.words.map((w) => {
        const cut = cutState(segments, w.from, w.to) !== 'kept';
        const selected = selection && w.from >= selection.from - 0.01 && w.to <= selection.to + 0.01;
        return (
          <span
            key={w.index}
            onMouseDown={(e) => onPress(w, e.shiftKey)}
            onMouseEnter={() => onEnter(w)}
            onMouseUp={() => onRelease(w)}
            style={{
              cursor: 'pointer',
              borderRadius: 3,
              padding: '1px 1px',
              textDecoration: cut ? 'line-through' : undefined,
              color: cut ? colors.textFaint : undefined,
              background: selected ? 'rgba(255,181,71,0.35)' : w.index === activeWord ? 'rgba(255,255,255,0.18)' : undefined,
            }}
          >
            {w.text}{' '}
          </span>
        );
      })}
    </div>
  );
});
