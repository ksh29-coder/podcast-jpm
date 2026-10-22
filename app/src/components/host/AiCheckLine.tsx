import { Text } from 'react-native';
import type { AiCheck } from '../../lib/host';
import { colors } from '../../theme';
import { ui } from './ui';

// The AI's read of what's said in a posted Short or episode: nothing flagged, what to
// check, or that there was nothing to read.
export function AiCheckLine({ check }: { check: AiCheck | undefined }) {
  if (!check) return null;
  if (check.status === 'ready' && check.concerns.length === 0) return <Text style={ui.hint}>AI check: nothing flagged in what’s said.</Text>;
  if (check.status === 'ready') return <Text style={[ui.hint, { color: colors.highlight }]}>AI check: {check.concerns.join(' · ')}</Text>;
  if (check.status === 'unavailable') return <Text style={ui.hint}>AI check: nothing spoken to check, so watch it.</Text>;
  return <Text style={ui.hint}>AI check: still reading it…</Text>;
}
