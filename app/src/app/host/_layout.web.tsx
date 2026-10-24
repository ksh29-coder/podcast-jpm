import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, Stack, usePathname } from 'expo-router';
import { HostGate, useHost } from '../../components/host/HostGate';
import { useHostData } from '../../components/host/useHostData';
import { Icon, type IconName } from '../../components/Icon';
import { hovered } from '../../components/web/hover';
import { colors, radius, spacing, type } from '../../theme';

// The Host Studio on the website: review what people post, manage episodes
// and Shorts, and upload. A sidebar of sections; pages inside a section get
// a Back button. The phone's host mode is _layout.tsx.
const SECTIONS: { path: string; label: string; icon: IconName }[] = [
  { path: '/host', label: 'Review', icon: 'checkCircle' },
  { path: '/host/episodes', label: 'Episodes', icon: 'film' },
  { path: '/host/shorts', label: 'Shorts', icon: 'shorts' },
];
const UPLOADS: { path: string; label: string; icon: IconName }[] = [
  { path: '/host/upload-episode', label: 'Upload episode', icon: 'upload' },
  { path: '/host/record', label: 'Record a Short', icon: 'video' },
];

const TITLES: [RegExp, string][] = [
  [/^\/host\/clip\//, 'Make a Short'],
  [/^\/host\/ai\//, 'AI assist'],
  [/^\/host\/episode\//, 'Edit episode'],
  [/^\/host\/short\//, 'Edit Short'],
  [/^\/host\/review\//, 'Review'],
];

export default function StudioLayout() {
  return (
    <HostGate onCancel={() => router.replace('/')}>
      <Studio />
    </HostGate>
  );
}

function Studio() {
  const path = usePathname();
  const { lock } = useHost();
  const { toReview, comments } = useHostData();
  const waiting = toReview.length + comments.length;
  const section = [...SECTIONS, ...UPLOADS].find((s) => s.path === path);
  const title = section?.label ?? TITLES.find(([re]) => re.test(path))?.[1] ?? 'Host Studio';
  const isSection = SECTIONS.some((s) => s.path === path);

  return (
    <View style={styles.root}>
      <View style={styles.sidebar}>
        <SideLink label="Back to AI Wave" icon="chevronLeft" muted onPress={() => router.replace('/')} />
        <Text style={styles.heading}>Host Studio</Text>
        <View style={{ gap: 2 }}>
          {SECTIONS.map((s) => (
            <SideLink
              key={s.path}
              label={s.label}
              icon={s.icon}
              active={path === s.path}
              badge={s.path === '/host' && waiting ? waiting : undefined}
              onPress={() => router.navigate(s.path as '/host')}
            />
          ))}
        </View>
        <Text style={styles.group}>Upload</Text>
        <View style={{ gap: 2 }}>
          {UPLOADS.map((s) => (
            <SideLink key={s.path} label={s.label} icon={s.icon} active={path === s.path} onPress={() => router.navigate(s.path as '/host')} />
          ))}
        </View>
        <View style={{ flex: 1 }} />
        <SideLink label="Lock host mode" icon="close" muted onPress={lock} />
      </View>
      <View style={styles.main}>
        <View style={styles.header}>
          {!isSection && (
            <Pressable
              onPress={() => (router.canGoBack() ? router.back() : router.navigate('/host'))}
              style={(s) => [styles.back, hovered(s) && { backgroundColor: colors.card }]}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Icon name="chevronLeft" size={18} />
              <Text style={type.subhead}>Back</Text>
            </Pressable>
          )}
          <Text style={type.title}>{title}</Text>
        </View>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
      </View>
    </View>
  );
}

function SideLink({ label, icon, active, muted, badge, onPress }: { label: string; icon: IconName; active?: boolean; muted?: boolean; badge?: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={(s) => [styles.item, hovered(s) && styles.itemHover, active && styles.itemActive]} accessibilityRole="link">
      <Icon name={icon} size={18} color={active ? colors.text : colors.textMuted} />
      <Text style={[styles.itemText, (!active || muted) && { color: colors.textMuted }]}>{label}</Text>
      {!!badge && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  sidebar: { width: 240, paddingHorizontal: spacing.md, paddingVertical: spacing.xl, gap: spacing.sm, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border, backgroundColor: '#0D0C12' },
  heading: { ...type.title, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
  group: { ...type.eyebrow, paddingHorizontal: spacing.md, paddingTop: spacing.lg },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, borderRadius: radius.md },
  itemHover: { backgroundColor: colors.card },
  itemActive: { backgroundColor: colors.cardHigh },
  itemText: { ...type.subhead, color: colors.text, fontWeight: '700', flex: 1 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: colors.highlight, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.accentText, fontSize: 12, fontWeight: '800' },
  main: { flex: 1, minWidth: 0 },
  // Lined up with the pages' content column (ui.page).
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, width: '100%', maxWidth: 1040, alignSelf: 'center', paddingHorizontal: 20, paddingTop: spacing.xl },
  back: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border },
});
