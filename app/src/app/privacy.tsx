import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, type } from '../theme';

const CONTACT = 'kaishen19@gmail.com';

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: 'What AI Wave is',
    body: ['A pilot app where colleagues share podcast episodes and short videos about AI and software-engineering practice. There are no accounts, ads or tracking across other apps, and nothing is sold.'],
  },
  {
    title: 'What we keep',
    body: [
      'A random ID made on your device, so likes, views and your listening position count once and follow you between sessions. It isn’t linked to your name, Apple ID or phone number.',
      'The name you choose to show on your posts and comments.',
      'Videos you post, with their title, description, tags, and a transcript of what’s said; your comments; likes, views and listening progress; reports you make.',
      'How many minutes you talk to the voice assistant each day (for the daily limit). We don’t record the conversation.',
    ],
  },
  {
    title: 'Who processes it',
    body: [
      'Mux hosts and streams the videos. Our database runs on Neon, and the service on Vercel.',
      'OpenRouter runs the AI that transcribes videos, suggests titles and checks posts for hosts.',
      'OpenAI runs the voice assistant: your voice goes to it live during a conversation, and its answers come back. Its own data policies apply to that conversation.',
    ],
  },
  {
    title: 'Who sees what',
    body: [
      'Anything you post is seen by a host first, and by everyone using the app once approved, with your chosen name.',
      'Hosts see posts waiting for review, reports, and an AI check of what’s said. They don’t see your device ID.',
    ],
  },
  {
    title: 'Deleting',
    body: [
      'Delete your posts any time from Me: the video, its likes, views and comments go with it. Posts a host doesn’t approve, and uploads you never post, are deleted after 7 days.',
      `To have everything linked to your device removed, email ${CONTACT}.`,
    ],
  },
];

// The privacy policy, linked from Me and from TestFlight.
export default function Privacy() {
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.page} contentInsetAdjustmentBehavior="automatic">
      <Text style={type.display}>Privacy</Text>
      <Text style={type.footnote}>AI Wave · Last updated 22 October 2026</Text>
      {SECTIONS.map((s) => (
        <View key={s.title} style={styles.section}>
          <Text style={type.headline}>{s.title}</Text>
          {s.body.map((p) => (
            <Text key={p} style={[type.body, { color: colors.textMuted }]}>
              {p}
            </Text>
          ))}
        </View>
      ))}
      <View style={styles.section}>
        <Text style={type.headline}>Contact</Text>
        <Text style={[type.body, { color: colors.highlight }]} onPress={() => Linking.openURL(`mailto:${CONTACT}`)} accessibilityRole="link">
          {CONTACT}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.xl, paddingBottom: spacing.huge * 2, gap: spacing.lg, width: '100%', maxWidth: 760, alignSelf: 'center' },
  section: { gap: spacing.sm, marginTop: spacing.md },
});
