import type { TextStyle } from 'react-native';

// "Studio" theme: dark and cinematic. Each episode's screens are tinted with
// a color taken from its artwork (Episode.tint); these are the constants
// around it. Dark-only by design.

export const colors = {
  bg: '#09090D',
  // Raised surfaces are translucent white, so they pick up any tint behind them.
  card: 'rgba(255,255,255,0.07)',
  cardHigh: 'rgba(255,255,255,0.12)',
  border: 'rgba(255,255,255,0.12)',
  text: '#F7F5FB',
  textMuted: 'rgba(247,245,251,0.62)',
  textFaint: 'rgba(247,245,251,0.40)',
  // Primary actions are white with dark text, like a media app's play button.
  accent: '#FFFFFF',
  accentText: '#09090D',
  // Small highlights: the current chapter, tags, "new".
  highlight: '#FFB547',
  liked: '#FF4D6D',
  danger: '#FF6B6B',
  // Backdrop when an episode has no artwork color yet.
  tintFallback: '#2E2440',
};

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48 } as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 22, full: 999 } as const;

// Type ramp after Apple's text styles, with a heavier display cut for titles.
export const type = {
  display: { fontSize: 30, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6, color: colors.text },
  title: { fontSize: 22, lineHeight: 27, fontWeight: '800', letterSpacing: -0.3, color: colors.text },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '700', color: colors.text },
  body: { fontSize: 16, lineHeight: 23, fontWeight: '400', color: colors.text },
  subhead: { fontSize: 15, lineHeight: 20, fontWeight: '500', color: colors.textMuted },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '500', color: colors.textMuted },
  // Small caps-style labels: "NEW EPISODE", section names.
  eyebrow: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: colors.textMuted },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500', color: colors.textMuted },
} as const satisfies Record<string, TextStyle>;

// "#rrggbb" + alpha 0–1 -> "rgba(...)", for fading an episode's tint.
export function withAlpha(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// The episode's tint as a top-to-bottom wash into the page background.
export function tintWash(tint: string | null | undefined) {
  const t = tint || colors.tintFallback;
  return `linear-gradient(180deg, ${withAlpha(t, 1)} 0%, ${withAlpha(t, 0.55)} 38%, ${colors.bg} 78%)`;
}
