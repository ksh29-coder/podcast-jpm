import Ionicons from '@expo/vector-icons/Ionicons';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { ColorValue } from 'react-native';
import { colors } from '../theme';

// One icon set for the app: SF Symbols on iPhone (so it looks like iOS),
// Ionicons on Android and the web. Screens use these names, never a
// platform's own.
const ICONS = {
  play: { sf: 'play.fill', ion: 'play' },
  pause: { sf: 'pause.fill', ion: 'pause' },
  back15: { sf: 'gobackward.15', ion: 'play-back' },
  forward30: { sf: 'goforward.30', ion: 'play-forward' },
  headphones: { sf: 'headphones', ion: 'headset' },
  video: { sf: 'video.fill', ion: 'videocam' },
  upload: { sf: 'icloud.and.arrow.up', ion: 'cloud-upload-outline' },
  close: { sf: 'xmark', ion: 'close' },
  heart: { sf: 'heart', ion: 'heart-outline' },
  heartFill: { sf: 'heart.fill', ion: 'heart' },
  comment: { sf: 'bubble.right', ion: 'chatbubble-ellipses-outline' },
  share: { sf: 'arrowshape.turn.up.right', ion: 'arrow-redo-outline' },
  eye: { sf: 'eye', ion: 'eye-outline' },
  flip: { sf: 'arrow.triangle.2.circlepath.camera', ion: 'camera-reverse-outline' },
  flash: { sf: 'bolt', ion: 'flash-outline' },
  flashOn: { sf: 'bolt.fill', ion: 'flash' },
  timer: { sf: 'timer', ion: 'timer-outline' },
  script: { sf: 'text.alignleft', ion: 'document-text-outline' },
  speed: { sf: 'gauge.with.dots.needle.67percent', ion: 'speedometer-outline' },
  check: { sf: 'checkmark', ion: 'checkmark' },
  checkCircle: { sf: 'checkmark.circle.fill', ion: 'checkmark-circle' },
  download: { sf: 'arrow.down.circle', ion: 'arrow-down-circle-outline' },
  phone: { sf: 'iphone', ion: 'phone-portrait-outline' },
  chevronDown: { sf: 'chevron.down', ion: 'chevron-down' },
  list: { sf: 'list.bullet', ion: 'list' },
  back10: { sf: 'gobackward.10', ion: 'play-back' },
  back30: { sf: 'gobackward.30', ion: 'play-back' },
  forward15: { sf: 'goforward.15', ion: 'play-forward' },
  forward45: { sf: 'goforward.45', ion: 'play-forward' },
  forward60: { sf: 'goforward.60', ion: 'play-forward' },
  moon: { sf: 'moon.zzz', ion: 'moon-outline' },
  moonFill: { sf: 'moon.zzz.fill', ion: 'moon' },
  transcript: { sf: 'quote.bubble', ion: 'reader-outline' },
  search: { sf: 'magnifyingglass', ion: 'search' },
  minus: { sf: 'minus', ion: 'remove' },
  link: { sf: 'arrow.up.right.square', ion: 'open-outline' },
  plus: { sf: 'plus', ion: 'add' },
  photos: { sf: 'photo.on.rectangle', ion: 'images-outline' },
  sparkles: { sf: 'sparkles', ion: 'sparkles-outline' },
  trash: { sf: 'trash', ion: 'trash-outline' },
  edit: { sf: 'pencil', ion: 'pencil' },
  chevronRight: { sf: 'chevron.right', ion: 'chevron-forward' },
  warning: { sf: 'exclamationmark.triangle', ion: 'warning-outline' },
  home: { sf: 'house', ion: 'home-outline' },
  shorts: { sf: 'play.rectangle.on.rectangle', ion: 'albums-outline' },
  person: { sf: 'person.crop.circle', ion: 'person-circle-outline' },
  shield: { sf: 'checkmark.shield', ion: 'shield-checkmark-outline' },
  chevronUp: { sf: 'chevron.up', ion: 'chevron-up' },
  chevronLeft: { sf: 'chevron.left', ion: 'chevron-back' },
  film: { sf: 'film', ion: 'film-outline' },
} as const satisfies Record<string, { sf: SFSymbol; ion: keyof typeof Ionicons.glyphMap }>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 22, color = colors.text }: { name: IconName; size?: number; color?: ColorValue }) {
  const icon = ICONS[name];
  const fallback = <Ionicons name={icon.ion} size={size} color={color as string} />;
  if (process.env.EXPO_OS !== 'ios') return fallback;
  return <SymbolView name={icon.sf} size={size} tintColor={color} weight="semibold" fallback={fallback} />;
}

// The skip button icon for a skip length (only lengths with a matching symbol are offered).
export function skipIcon(dir: 'back' | 'forward', seconds: number): IconName {
  const name = `${dir}${seconds}`;
  return (name in ICONS ? name : dir === 'back' ? 'back15' : 'forward30') as IconName;
}
