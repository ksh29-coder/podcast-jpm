import { useRef, useState } from 'react';
import type { EditCut, EditText } from '../../../lib/host';
import { clock, type Range } from '../../../lib/edit';
import { colors } from '../../../theme';

// The whole original along one bar: cut parts in red (dashed while only
// suggested), texts underneath, the selection, and where it's playing.
// Click to jump; drag to select.
export function Timeline({ durationSec, cuts, texts, selection, now, onSeek, onSelect }: {
  durationSec: number;
  cuts: EditCut[];
  texts: EditText[];
  selection: Range | null;
  now: number;
  onSeek: (t: number) => void;
  onSelect: (range: Range | null) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<{ start: number; x: number } | null>(null);
  const [hover, setHover] = useState<{ t: number; x: number } | null>(null);
  const pct = (t: number) => `${(Math.min(Math.max(t, 0), durationSec) / durationSec) * 100}%`;
  const at = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return { t: Math.min(Math.max((clientX - r.left) / r.width, 0), 1) * durationSec, x: clientX - r.left };
  };
  const span = (from: number, to: number) => ({ left: pct(from), width: `calc(${pct(to)} - ${pct(from)})` });

  return (
    <div style={{ userSelect: 'none' }}>
      <div
        ref={bar}
        role="slider"
        aria-label="Timeline"
        aria-valuemin={0}
        aria-valuemax={durationSec}
        aria-valuenow={now}
        style={{ position: 'relative', height: 44, borderRadius: 8, background: colors.cardHigh, cursor: 'pointer', overflow: 'hidden' }}
        onMouseDown={(e) => {
          drag.current = { start: at(e.clientX).t, x: e.clientX };
        }}
        onMouseMove={(e) => {
          setHover(at(e.clientX));
          const d = drag.current;
          if (d && Math.abs(e.clientX - d.x) > 3) {
            const t = at(e.clientX).t;
            onSelect({ from: Math.min(d.start, t), to: Math.max(d.start, t) });
          }
        }}
        onMouseUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d && Math.abs(e.clientX - d.x) <= 3) onSeek(at(e.clientX).t);
        }}
        onMouseLeave={() => {
          drag.current = null;
          setHover(null);
        }}
      >
        {cuts.map((c) => (
          <div
            key={c.id}
            title={`Cut ${clock(c.from)}–${clock(c.to)}${c.reason ? `: ${c.reason}` : ''}`}
            style={{
              position: 'absolute', top: 0, bottom: 0, ...span(c.from, c.to),
              minWidth: 2,
              background: c.state === 'suggested' ? 'rgba(255,107,107,0.25)' : 'rgba(255,107,107,0.65)',
              borderLeft: c.state === 'suggested' ? `1px dashed ${colors.danger}` : undefined,
            }}
          />
        ))}
        {selection && (
          <div style={{ position: 'absolute', top: 0, bottom: 0, ...span(selection.from, selection.to), background: 'rgba(255,181,71,0.25)', outline: `2px solid ${colors.highlight}`, outlineOffset: -2 }} />
        )}
        {hover && <div style={{ position: 'absolute', top: 0, bottom: 0, left: hover.x, width: 1, background: 'rgba(255,255,255,0.35)' }} />}
        <div style={{ position: 'absolute', top: -2, bottom: -2, left: pct(now), width: 2, marginLeft: -1, background: '#fff' }} />
      </div>
      <div style={{ position: 'relative', height: 10, marginTop: 4 }}>
        {texts.map((t) => (
          <div
            key={t.id}
            title={`${t.text} (${clock(t.from)}–${clock(t.to)})`}
            onClick={() => onSeek(t.from)}
            style={{ position: 'absolute', top: 0, height: 8, ...span(t.from, t.to), minWidth: 3, borderRadius: 4, background: '#7AA7FF', opacity: t.state === 'suggested' ? 0.5 : 1, cursor: 'pointer' }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: colors.textMuted, fontSize: 12, fontVariantNumeric: 'tabular-nums', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }}>
        <span>0:00</span>
        <span>{hover ? clock(hover.t) : ''}</span>
        <span>{clock(durationSec)}</span>
      </div>
    </div>
  );
}
