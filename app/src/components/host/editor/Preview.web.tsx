import { useEffect, useRef, useState, type RefObject } from 'react';
import type { EditText } from '../../../lib/host';
import { TEXT_STYLES } from '../../../lib/edit';
import { attachHls } from '../../hls.web';

// The editor's player: the original upload, with the texts on screen at the
// moment playing drawn over it the way the edited video will draw them (the
// final video's text is made by the server, in the same places and sizes).
export function Preview({ videoRef, url, poster, texts, now, onTime, onAspect }: {
  videoRef: RefObject<HTMLVideoElement | null>;
  url: string;
  poster: string | null;
  texts: EditText[];
  now: number;
  onTime: (t: number) => void;
  onAspect: (aspect: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const [aspect, setAspect] = useState(16 / 9);

  useEffect(() => {
    const el = videoRef.current;
    return el ? attachHls(el, url) : undefined;
  }, [videoRef, url]);

  // Text sizes are a share of the picture's height.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const watch = new ResizeObserver(() => setHeight(el.clientHeight));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  const showing = texts.filter((t) => now >= t.from && now < t.to);

  return (
    <div ref={box} style={{ position: 'relative', width: '100%', aspectRatio: String(aspect), background: '#000', borderRadius: 12, overflow: 'hidden' }}>
      <video
        ref={videoRef}
        poster={poster ?? undefined}
        playsInline
        style={{ width: '100%', height: '100%', display: 'block' }}
        onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)}
        onSeeked={(e) => onTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const { videoWidth: w, videoHeight: h } = e.currentTarget;
          if (w && h) {
            setAspect(w / h);
            onAspect(w / h);
          }
        }}
        onClick={(e) => (e.currentTarget.paused ? e.currentTarget.play() : e.currentTarget.pause())}
      />
      {showing.map((t) => (
        <TextOnScreen key={t.id} text={t} height={height} />
      ))}
    </div>
  );
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
      }}
    >
      {line(text.text, size, 700)}
      {text.subtitle && <div>{line(text.subtitle, (s.subtitleSize ?? s.size) * height, 400)}</div>}
    </div>
  );
}
