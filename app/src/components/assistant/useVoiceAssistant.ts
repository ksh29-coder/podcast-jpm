import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { usePlayer } from '../../lib/player';
import { connectVoice, type VoiceConnection, type VoiceEvent } from './rtc';

// One conversation with the voice assistant: connects, keeps track of who's
// talking, runs the assistant's tools (on our server) and collects the cards
// it asks to show. Ends at the session's time limit, on End, or on leaving.

export type AssistantState = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'ended' | 'error';

// Something the assistant found, as a card on screen.
export type Card =
  | { kind: 'episode'; id: string; title: string; minutes?: number; by?: string | null; artworkUrl?: string }
  | { kind: 'short'; id: string; title: string; by?: string | null; artworkUrl?: string }
  | { kind: 'moment'; id: string; episodeTitle: string; startSec: number; said: string };

type Found = Record<string, Card>;
const momentKey = (id: string, sec: number) => `${id}@${Math.round(sec)}`;

// `voice`: how it sounds. Choosing another voice means a new conversation
// (the screen remounts this with the new voice).
export function useVoiceAssistant(voice: string) {
  const { pause } = usePlayer();
  const [state, setState] = useState<AssistantState>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [left, setLeft] = useState<number | null>(null);
  const conn = useRef<VoiceConnection | null>(null);
  const startedAt = useRef(0);
  const found = useRef<Found>({});
  const ended = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Remember what the tools returned, so show_cards can name them by id.
  const remember = (result: unknown) => {
    const r = result as { episodes?: Card[]; shorts?: Card[]; moments?: (Card & { startSec: number })[]; kind?: string; id?: string; title?: string };
    for (const e of r.episodes ?? []) found.current[e.id] = e;
    for (const s of r.shorts ?? []) found.current[s.id] = s;
    for (const m of r.moments ?? []) found.current[momentKey(m.id, m.startSec)] = m;
    if (r.kind === 'episode' && r.id) found.current[r.id] = r as Card;
  };

  const stop = useCallback(() => {
    if (ended.current) return;
    ended.current = true;
    if (timer.current) clearInterval(timer.current);
    conn.current?.close();
    conn.current = null;
    setState((s) => (s === 'error' ? s : 'ended'));
    if (startedAt.current) api.assistantUsage((Date.now() - startedAt.current) / 1000).catch(() => {});
  }, []);

  const onEvent = useCallback(
    async (e: VoiceEvent) => {
      switch (e.type) {
        case 'input_audio_buffer.speech_started':
          return setState('listening');
        case 'input_audio_buffer.speech_stopped':
        case 'response.created':
          return setState((s) => (s === 'speaking' ? s : 'thinking'));
        case 'output_audio_buffer.started':
          return setState('speaking');
        case 'output_audio_buffer.stopped':
        case 'output_audio_buffer.cleared':
          return setState('listening');
        case 'connection.closed':
          return stop();
        case 'error': {
          const message = (e.error as { message?: string })?.message;
          // Cancelling a reply that already finished is harmless.
          if (message && !/no active response/i.test(message)) console.warn('assistant', message);
          return;
        }
        case 'response.function_call_arguments.done': {
          const name = String(e.name);
          const callId = String(e.call_id);
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(String(e.arguments || '{}'));
          } catch {
            // Treated as no arguments.
          }
          let output: unknown;
          if (name === 'show_cards') {
            const items = (args.items as { kind: string; id: string; start_sec?: number }[]) ?? [];
            const shown = items
              .map((i) => (i.kind === 'moment' && i.start_sec != null ? found.current[momentKey(i.id, i.start_sec)] : found.current[i.id]))
              .filter((c): c is Card => !!c);
            setCards((cur) => [...shown, ...cur.filter((c) => !shown.some((s) => s.id === c.id && s.kind === c.kind))].slice(0, 12));
            output = { shown: shown.length };
          } else {
            output = await api.assistantTool(name, args).catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }));
            remember(output);
          }
          conn.current?.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(output) } });
          conn.current?.send({ type: 'response.create' });
          return;
        }
      }
    },
    [stop]
  );

  // Connect on arrival.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // An episode playing would talk over the assistant.
        pause();
        const session = await api.assistantSession(voice);
        if (cancelled) return;
        const c = await connectVoice({ token: session.token, connectUrl: session.connectUrl, onEvent });
        if (cancelled) return c.close();
        conn.current = c;
        startedAt.current = Date.now();
        setLeft(session.maxSec);
        setState('thinking');
        c.send({ type: 'response.create', response: { instructions: 'Greet the person in one short, friendly sentence and ask what they would like to find on AI Dev Wave.' } });
        const deadline = Date.now() + session.maxSec * 1000;
        const t = setInterval(() => {
          const s = Math.max(0, Math.round((deadline - Date.now()) / 1000));
          setLeft(s);
          if (s === 0) {
            clearInterval(t);
            stop();
          }
        }, 1000);
        timer.current = t;
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setState('error');
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
    // Once per screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, error, cards, left, stop };
}
