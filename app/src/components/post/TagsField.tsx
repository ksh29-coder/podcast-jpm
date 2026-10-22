import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius, spacing, type } from '../../theme';
import { Icon } from '../Icon';

const MAX_TAGS = 10;

const clean = (t: string) => t.trim().replace(/^#+/, '').toLowerCase().slice(0, 30);

// Tags as chips: type a word and press space, comma or return to add it;
// tap × to remove one. `suggested` tags not yet added show as + chips.
export function TagsField({ tags, onChange, suggested = [] }: { tags: string[]; onChange: (t: string[]) => void; suggested?: string[] }) {
  const [text, setText] = useState('');

  const add = (raw: string) => {
    const t = clean(raw);
    if (t && !tags.includes(t) && tags.length < MAX_TAGS) onChange([...tags, t]);
  };
  const extra = suggested.filter((t) => !tags.includes(t));

  return (
    <View style={styles.wrap}>
      <View style={styles.box}>
        {tags.map((t) => (
          <Pressable key={t} style={styles.chip} onPress={() => onChange(tags.filter((x) => x !== t))} accessibilityRole="button" accessibilityLabel={`Remove tag ${t}`}>
            <Text style={styles.chipText}>#{t}</Text>
            <Icon name="close" size={12} color={colors.textMuted} />
          </Pressable>
        ))}
        {tags.length < MAX_TAGS && (
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={(v) => {
              // A space or comma finishes a tag.
              if (/[\s,]$/.test(v)) {
                add(v);
                setText('');
              } else setText(v);
            }}
            onSubmitEditing={() => {
              add(text);
              setText('');
            }}
            onBlur={() => {
              add(text);
              setText('');
            }}
            submitBehavior="submit"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={tags.length ? 'Add a tag' : 'e.g. prompting, testing'}
            placeholderTextColor={colors.textFaint}
            accessibilityLabel="Add a tag"
          />
        )}
      </View>
      {extra.length > 0 && (
        <View style={styles.suggested}>
          {extra.map((t) => (
            <Pressable key={t} style={[styles.chip, styles.chipSuggested]} onPress={() => add(t)} accessibilityRole="button" accessibilityLabel={`Add suggested tag ${t}`}>
              <Icon name="plus" size={12} color={colors.highlight} />
              <Text style={[styles.chipText, { color: colors.highlight }]}>{t}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  box: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    minHeight: 48,
  },
  input: { flexGrow: 1, minWidth: 120, color: colors.text, fontSize: 16, paddingVertical: spacing.xs, paddingHorizontal: spacing.xs },
  chip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.full, backgroundColor: colors.cardHigh },
  chipSuggested: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.highlight, borderStyle: 'dashed' },
  chipText: { ...type.footnote, color: colors.text, fontWeight: '600' },
  suggested: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
