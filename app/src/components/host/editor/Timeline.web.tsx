import { useRef, useState } from 'react';
import type { EditCut, EditScene, EditText, EditZoom } from '../../../lib/host';
import { clock, type Range } from '../../../lib/edit';
import { colors } from '../../../theme';

// Colors of the layouts in the timeline.
export const LAYOUT_COLOR: Record<EditScene['layout'], string> = { speaker: '#8E8E9A', screen: '#4FD1A5', 'screen+speaker': '#B48CFF', 'side-by-side': '#FF9F6B' };

// The whole original along one bar: cut parts in red (dashed while only
// suggested), texts and layouts (with zooms) underneath, the selection, and
// where it's playing. Click to jump; drag to select.
export function Timeline({ durationSec, cuts, texts, scenes = [], zooms = [], selection, now, onSeek, onSelect }: {
  durationSec: number;
  cuts: EditCut[];
  texts: EditText[];
  scenes?: EditScene[];
  zooms?: EditZoom[];
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
      {scenes.length + zooms.length > 0 && (
        <div style={{ position: 'relative', height: 10, marginTop: 2 }}>
          {scenes.map((sc) => (
            <div
              key={sc.id}
              title={`${sc.layout} (${clock(sc.from)}–${clock(sc.to)})`}
              onClick={() => onSeek(sc.from)}
              style={{ position: 'absolute', top: 0, height: 8, ...span(sc.from, sc.to), minWidth: 3, borderRadius: 4, background: LAYOUT_COLOR[sc.layout], opacity: sc.state === 'suggested' ? 0.5 : 1, cursor: 'pointer' }}
            />
          ))}
          {zooms.map((z) => (
            <div key={z.id} title={`Zoom (${clock(z.from)}–${clock(z.to)})`} style={{ position: 'absolute', top: 2, height: 4, ...span(z.from, z.to), minWidth: 3, background: '#FFE14D', pointerEvents: 'none' }} />
          ))}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', color: colors.textMuted, fontSize: 12, fontVariantNumeric: 'tabular-nums', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }}>
        <span>0:00</span>
        <span>{hover ? clock(hover.t) : ''}</span>
        <span>{clock(durationSec)}</span>
      </div>
    </div>
  );
}
