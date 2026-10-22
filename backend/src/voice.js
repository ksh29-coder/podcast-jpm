// The only file that talks to the live voice service. The app connects to
// the service directly (WebRTC) with a short-lived key made here, so our
// own API key never leaves the server. Moving to another service (e.g.
// Amazon Nova Sonic inside JPM) means rewriting this file and the app's
// connection code, nothing else.
//
// Currently OpenAI Realtime: https://developers.openai.com/api/docs/guides/realtime-webrtc

// The voices people can pick from (the service rejects anything else).
const VOICES = ['marin', 'cedar', 'coral', 'ash', 'sage', 'verse', 'shimmer', 'echo', 'ballad', 'alloy'];

function openAiVoice({ apiKey = process.env.OPENAI_API_KEY, model = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1', defaultVoice = 'marin' } = {}) {
  if (!apiKey) return null;
  return {
    model,
    voices: VOICES,
    // A key the app uses for one conversation. `tools` are run by the app,
    // which calls our backend for them.
    async createSession({ instructions, tools, voice = defaultVoice }) {
      const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expires_after: { anchor: 'created_at', seconds: 600 },
          session: {
            type: 'realtime',
            model,
            instructions,
            tools,
            tool_choice: 'auto',
            audio: {
              input: { turn_detection: { type: 'semantic_vad' } },
              output: { voice },
            },
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.value) {
        throw Object.assign(new Error(`Voice service: ${json.error?.message || res.status}`), { status: 502 });
      }
      return { token: json.value, connectUrl: 'https://api.openai.com/v1/realtime/calls', expiresAt: json.expires_at ?? null };
    },
  };
}

module.exports = { openAiVoice, VOICES };
