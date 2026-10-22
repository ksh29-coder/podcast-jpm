import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text } from 'react-native';
import { api, type ItemType } from '../../lib/api';
import { blockAuthor } from '../../lib/blocked';
import { colors, radius, spacing, type } from '../../theme';
import { Icon } from '../Icon';

const REASONS = ['Confidential or client information', 'Offensive or inappropriate', 'Spam or not about AI or software'];

// The ⋯ menu on an episode or Short: report it, or hide everything from the
// person who posted it. A sheet rather than a system alert, so it works the
// same on the phone and the website.
export function PostMenu({
  visible,
  onClose,
  itemType,
  id,
  author,
}: {
  visible: boolean;
  onClose: () => void;
  itemType: ItemType;
  id: string;
  author: { name: string; key: string } | null;
}) {
  const [step, setStep] = useState<'menu' | 'reasons' | 'done'>('menu');
  const [message, setMessage] = useState('');
  const close = () => {
    setStep('menu');
    onClose();
  };
  const report = async (reason: string) => {
    try {
      await api.reportItem(itemType, id, reason);
      setMessage(author ? 'Thanks. It’s hidden until a host has looked at it.' : 'Thanks. A host will look at it.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
    setStep('done');
  };
  const hide = async () => {
    if (!author) return;
    await blockAuthor(author.key);
    setMessage(`You won’t see posts or comments from ${author.name} on this device. Show them again from Me.`);
    setStep('done');
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close">
        <Pressable style={styles.sheet} onPress={() => {}}>
          {step === 'menu' && (
            <>
              <Option icon="flag" label={`Report this ${itemType === 'short' ? 'Short' : 'episode'}`} onPress={() => setStep('reasons')} />
              {author && <Option icon="eyeSlash" label={`Hide posts from ${author.name}`} onPress={hide} />}
            </>
          )}
          {step === 'reasons' && (
            <>
              <Text style={[type.eyebrow, { padding: spacing.md }]}>What’s wrong with it?</Text>
              {REASONS.map((r) => (
                <Option key={r} label={r} onPress={() => report(r)} />
              ))}
            </>
          )}
          {step === 'done' && <Text style={[type.body, { padding: spacing.lg }]}>{message}</Text>}
          <Pressable style={styles.cancel} onPress={close} accessibilityRole="button">
            <Text style={styles.cancelText}>{step === 'done' ? 'Done' : 'Cancel'}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Option({ label, icon, onPress }: { label: string; icon?: 'flag' | 'eyeSlash'; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.cardHigh }]} onPress={onPress} accessibilityRole="button">
      {icon && <Icon name={icon} size={20} />}
      <Text style={type.headline}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end', alignItems: 'center', padding: spacing.lg },
  sheet: { width: '100%', maxWidth: 480, borderRadius: radius.xl, backgroundColor: '#1A1922', padding: spacing.sm, gap: 2, marginBottom: spacing.xl },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.md },
  cancel: { alignItems: 'center', padding: spacing.lg, marginTop: spacing.xs, borderRadius: radius.md, backgroundColor: colors.card },
  cancelText: { ...type.headline, color: colors.text },
});
