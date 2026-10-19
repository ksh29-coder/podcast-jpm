import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError } from '../../lib/api';
import { hostApi, loadPasscode, savePasscode, type HostApi } from '../../lib/host';
import { colors } from '../../theme';
import { ui } from './ui';

type HostContextValue = { api: HostApi; lock: () => void };
const HostContext = createContext<HostContextValue | null>(null);

export function useHost() {
  const value = useContext(HostContext);
  if (!value) throw new Error('useHost must be used inside <HostGate>');
  return value;
}

type State = { phase: 'loading' } | { phase: 'locked'; error?: string } | { phase: 'unlocked'; api: HostApi };

async function check(passcode: string): Promise<State> {
  const api = hostApi(passcode);
  try {
    await api.session();
    return { phase: 'unlocked', api };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return { phase: 'locked', error: 'That passcode is not right.' };
    return { phase: 'locked', error: e instanceof Error ? e.message : String(e) };
  }
}

// Shows a passcode screen until the host unlocks, then the host screens.
export function HostGate({ children, onCancel }: { children: ReactNode; onCancel: () => void }) {
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    loadPasscode().then(async (saved) => {
      if (!saved) return setState({ phase: 'locked' });
      const next = await check(saved);
      // A saved passcode that stopped working (e.g. it was changed) is forgotten.
      if (next.phase === 'locked') await savePasscode(null);
      setState(next);
    });
  }, []);

  if (state.phase === 'loading') return <ActivityIndicator style={{ flex: 1, backgroundColor: colors.bg }} color={colors.accent} />;
  if (state.phase === 'locked') {
    return (
      <PasscodeForm
        error={state.error}
        onCancel={onCancel}
        onSubmit={async (passcode) => {
          const next = await check(passcode);
          if (next.phase === 'unlocked') await savePasscode(passcode);
          setState(next);
        }}
      />
    );
  }
  const lock = () => {
    savePasscode(null);
    setState({ phase: 'locked' });
  };
  return <HostContext.Provider value={{ api: state.api, lock }}>{children}</HostContext.Provider>;
}

function PasscodeForm({ error, onSubmit, onCancel }: { error?: string; onSubmit: (passcode: string) => Promise<void>; onCancel: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!value.trim() || busy) return;
    setBusy(true);
    await onSubmit(value.trim());
    setBusy(false);
  };
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Host mode</Text>
      <Text style={styles.detail}>Enter the host passcode to upload and publish episodes and Shorts.</Text>
      <TextInput
        style={[ui.input, styles.input]}
        value={value}
        onChangeText={setValue}
        placeholder="Host passcode"
        placeholderTextColor={colors.textMuted}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        onSubmitEditing={submit}
        accessibilityLabel="Host passcode"
      />
      {error && <Text style={ui.error}>{error}</Text>}
      <Pressable style={[ui.button, (!value.trim() || busy) && ui.buttonDisabled]} onPress={submit} disabled={!value.trim() || busy}>
        <Text style={ui.buttonText}>{busy ? 'Checking…' : 'Unlock'}</Text>
      </Pressable>
      <Pressable style={[ui.button, ui.secondary]} onPress={onCancel}>
        <Text style={ui.secondaryText}>Back to the app</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', padding: 24, gap: 12, backgroundColor: colors.bg, maxWidth: 420, width: '100%', alignSelf: 'center' },
  title: { color: colors.text, fontSize: 24, fontWeight: '800' },
  detail: { color: colors.textMuted, fontSize: 15, lineHeight: 21 },
  input: { marginTop: 8 },
});
