import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { EditScene, EditText, EditZoom } from '../../../lib/host';
import { TEXT_STYLES, zoomAmount } from '../../../lib/edit';
import { attachHls } from '../../hls.web';

export type Screen = { url: string; offsetSec: number; durationSec: number };
export type Drawn = { x: number; y: number; w: number; h: number };

// Sizes as the edited video has them (the backend's edit-engine/ffmpeg.js).
const PIP_WIDTH = 0.26;
const PIP_MARGIN = 0.025;
const SIDE_SCREEN = 0.64;

// The editor's player: the original upload (and the screen recording, kept
// in step with it), laid out and zoomed as the scene playing says, with the
// texts on screen drawn over it, the way the edited video will have them.
// With `drawing`, dragging over the screen draws a zoom area.
export function Preview({ videoRef, url, poster, texts, screen, scene, zooms, now, drawing, onDraw, onTime }: {
  videoRef: RefObject<HTMLVideoElement | null>;
  url: string;
  poster: string | null;
  texts: EditText[];
  screen: Screen | null;
  scene: EditScene | null;
  zooms: EditZoom[];
  now: number;
  drawing: boolean;
  onDraw: (rect: Drawn) => void;
  onTime: (t: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const screenBox = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLVideoElement>(null);
  const [height, setHeight] = useState(0);
  const [aspect, setAspect] = useState(16 / 9);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    return el ? attachHls(el, url) : undefined;
  }, [videoRef, url]);
  useEffect(() => {
    const el = screenRef.current;
    return el && screen?.url ? attachHls(el, screen.url) : undefined;
  }, [screen?.url]);

  // Text sizes are a share of the picture's height.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const watch = new ResizeObserver(() => setHeight(el.clientHeight));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  // The screen recording follows the original: same moment (less its
  // offset), playing when it plays, blank where it doesn't cover.
  useEffect(() => {
    if (!screen) return;
    let frame = 0;
    const tick = () => {
      const m = videoRef.current;
      const s = screenRef.current;
      if (m && s) {
        const target = m.currentTime - screen.offsetSec;
        const covered = target >= 0 && target <= screen.durationSec;
        s.style.visibility = covered ? 'visible' : 'hidden';
        if (covered && Math.abs(s.currentTime - target) > 0.3) s.currentTime = target;
        if (covered && !m.paused && s.paused) s.play().catch(() => {});
        if ((m.paused || !covered) && !s.paused) s.pause();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [screen, videoRef]);

  // While drawing a zoom area, the screen fills the picture to draw on.
  const layout = screen ? (drawing ? 'screen' : (scene?.layout ?? 'speaker')) : 'speaker';
  const width = height * aspect;
  const margin = width * PIP_MARGIN;
  const pip = scene?.pip ?? 'bottom-right';
  const full: CSSProperties = { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' };
  const speakerStyle: CSSProperties =
    layout === 'screen'
      ? { ...full, opacity: 0 }
      : layout === 'screen+speaker'
        ? {
            position: 'absolute',
            width: width * PIP_WIDTH,
            height: (width * PIP_WIDTH) / aspect,
            [pip.endsWith('left') ? 'left' : 'right']: margin,
            [pip.startsWith('top') ? 'top' : 'bottom']: margin,
            objectFit: 'cover',
            zIndex: 2,
          }
        : layout === 'side-by-side'
          ? { position: 'absolute', top: 0, height: '100%', left: `${SIDE_SCREEN * 100}%`, width: `${(1 - SIDE_SCREEN) * 100}%`, objectFit: 'cover' }
          : full;
  const screenBoxStyle: CSSProperties =
    layout === 'speaker'
      ? { ...full, visibility: 'hidden' }
      : layout === 'side-by-side'
        ? { position: 'absolute', top: 0, left: 0, height: '100%', width: `${SIDE_SCREEN * 100}%`, overflow: 'hidden', background: '#111' }
        : { ...full, overflow: 'hidden', background: '#111' };

  const showing = texts.filter((t) => now >= t.from && now < t.to);
  const fraction = (e: { clientX: number; clientY: number }) => {
    const r = screenBox.current!.getBoundingClientRect();
    return { x: Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1), y: Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1) };
  };

  return (
    <div ref={box} style={{ position: 'relative', width: '100%', aspectRatio: String(aspect), background: '#000', borderRadius: 12, overflow: 'hidden' }}>
      {screen && (
        <div ref={screenBox} style={screenBoxStyle}>
          <video ref={screenRef} muted playsInline style={{ width: '100%', height: '100%', display: 'block', objectFit: 'contain', ...zoomStyle(zooms, 'screen', now) }} />
          {drawing && (
            <div
              style={{ position: 'absolute', inset: 0, cursor: 'crosshair', zIndex: 5, background: 'rgba(0,0,0,0.15)' }}
              onMouseDown={(e) => {
                const p = fraction(e);
                setDrag({ x0: p.x, y0: p.y, x: p.x, y: p.y });
              }}
              onMouseMove={(e) => drag && setDrag({ ...drag, ...fraction(e) })}
              onMouseUp={() => {
                if (drag) onDraw({ x: Math.min(drag.x0, drag.x), y: Math.min(drag.y0, drag.y), w: Math.abs(drag.x - drag.x0), h: Math.abs(drag.y - drag.y0) });
                setDrag(null);
              }}
            >
              {drag && (
                <div
                  style={{
                    position: 'absolute',
                    left: `${Math.min(drag.x0, drag.x) * 100}%`,
                    top: `${Math.min(drag.y0, drag.y) * 100}%`,
                    width: `${Math.abs(drag.x - drag.x0) * 100}%`,
                    height: `${Math.abs(drag.y - drag.y0) * 100}%`,
                    outline: '2px solid #FFB547',
                  }}
                />
              )}
            </div>
          )}
        </div>
      )}
      <video
        ref={videoRef}
        poster={poster ?? undefined}
        playsInline
        style={{ display: 'block', ...speakerStyle, ...(layout === 'speaker' ? zoomStyle(zooms, 'speaker', now) : {}) }}
        onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)}
        onSeeked={(e) => onTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const { videoWidth: w, videoHeight: h } = e.currentTarget;
          if (w && h) setAspect(w / h);
        }}
        onClick={(e) => (e.currentTarget.paused ? e.currentTarget.play() : e.currentTarget.pause())}
      />
      {showing.map((t) => (
        <TextOnScreen key={t.id} text={t} height={height} />
      ))}
    </div>
  );
}

// The zoom on a recording at time t, as a CSS transform: scaled up and moved
// so the rect's middle is in the middle, without showing past the picture's edges.
function zoomStyle(zooms: EditZoom[], source: string, t: number): CSSProperties {
  const z = zooms.find((x) => x.source === source && t >= x.from && t < x.to);
  if (!z) return {};
  const amount = zoomAmount(z, t);
  const [x, y, w, h] = z.rect;
  const scale = 1 + (1 / Math.max(w, h) - 1) * amount;
  const keep = (c: number) => Math.min(Math.max(c, 0.5 / scale), 1 - 0.5 / scale);
  const cx = keep(0.5 + (x + w / 2 - 0.5) * amount);
  const cy = keep(0.5 + (y + h / 2 - 0.5) * amount);
  return { transform: `scale(${scale}) translate(${(0.5 - cx) * 100}%, ${(0.5 - cy) * 100}%)`, transformOrigin: 'center' };
}

// Where the anchor point sits on the text, by keypad position.
const ANCHOR: Record<1 | 2 | 5 | 7, string> = { 1: 'translate(0, -100%)', 2: 'translate(-50%, -100%)', 5: 'translate(-50%, -50%)', 7: 'none' };

function TextOnScreen({ text, height }: { text: EditText; height: number }) {
  const s = TEXT_STYLES[text.style];
  const size = s.size * height;
  const line = (words: string, px: number, weight: number) => (
    <span style={{ display: 'inline-block', background: 'rgba(16,16,16,0.75)', padding: `${px * 0.1}px ${px * 0.25}px`, fontSize: px, fontWeight: weight, lineHeight: 1.2, whiteSpace: 'pre-wrap' }}>
      {words}
    </span>
  );
  return (
    <div
      style={{
        position: 'absolute',
        left: `${(text.x ?? s.x) * 100}%`,
        top: `${(text.y ?? s.y) * 100}%`,
        transform: ANCHOR[s.align],
        maxWidth: '90%',
        color: '#fff',
        fontFamily: 'Inter, system-ui, sans-serif',
        textAlign: s.align === 1 || s.align === 7 ? 'left' : 'center',
        opacity: text.state === 'suggested' ? 0.6 : 1,
        pointerEvents: 'none',
        zIndex: 3,
      }}
    >
      {line(text.text, size, 700)}
      {text.subtitle && <div>{line(text.subtitle, (s.subtitleSize ?? s.size) * height, 400)}</div>}
    </div>
  );
}
