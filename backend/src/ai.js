// AI help, through OpenRouter (model from OPENROUTER_MODEL).
// For hosts: reads an episode's transcript and suggests a summary, chapters,
// tags, things mentioned, and moments that would make good Shorts.
// For anyone posting a Short: suggests its details from what's said, and
// checks it for the host who reviews it.
// Suggestions are checked here and only reach viewers once a person accepts them.

const KINDS = ['tool', 'product', 'company', 'person', 'paper', 'concept'];

function openRouterAi({ apiKey = process.env.OPENROUTER_API_KEY, model = process.env.OPENROUTER_MODEL || 'z-ai/glm-5.2' } = {}) {
  // One JSON reply from the model.
  async function ask({ system, user, maxTokens }) {
    if (!apiKey) throw Object.assign(new Error('AI isn’t set up on this server'), { status: 503 });
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'AI Dev Wave' },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        reasoning: { effort: 'low' },
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) {
      throw Object.assign(new Error(`AI request failed: ${json.error?.message || res.status}`), { status: 502 });
    }
    const content = json.choices?.[0]?.message?.content || '';
    try {
      // Some models wrap JSON in a code fence despite being asked not to.
      return JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      throw Object.assign(new Error('The AI reply wasn’t valid JSON'), { status: 502 });
    }
  }

  return {
    model,
    async episodeInsights({ title, description, durationSec, cues }) {
      const hasSpeakers = cues.some((c) => Number.isInteger(c.speaker));
      const lines = cues.map((c) => `[${Math.floor(c.startSec)}s]${Number.isInteger(c.speaker) ? ` S${c.speaker}:` : ''} ${c.text}`).join('\n');
      return ask({
        maxTokens: 8000,
        system:
          'You help the hosts of an internal software-engineering podcast. You turn an episode transcript into structured metadata. ' +
          'Only use what is actually said in the transcript. Reply with one JSON object and nothing else.',
        user: `Episode title: ${title}
Description: ${description || '(none)'}
Length: ${Math.round(durationSec)} seconds
Transcript (each line starts with its time in seconds${hasSpeakers ? ' and speaker label' : ''}):
${lines}

Return JSON with exactly these keys:
- "summary": 2–3 plain sentences describing the episode for a listener.
- "chapters": 3–10 chapters at real topic changes, [{"startSec": number, "title": string (max 60 chars)}], the first at 0. Fewer for very short episodes.
- "tags": 3–8 short lowercase topic tags.
- "mentions": tools, products, companies, people, papers or concepts that are explicitly named, [{"startSec": number, "name": string, "kind": one of ${KINDS.join(', ')}, "url": official https homepage if you are certain, else null}].
- "speakers": ${hasSpeakers ? 'the name of each speaker label (S0, S1…) when the transcript makes it clear (for example someone says "I\'m your host, Kai"), as {"0": "Kai"}; leave out speakers you can\'t name' : '{}'}.
- "shorts": 1–4 self-contained moments of 20–90 seconds that would work as standalone vertical clips, [{"startSec": number, "endSec": number, "title": string (max 70 chars), "why": string (one sentence)}].`,
      });
    },

    // Details for a Short or episode someone is posting, and a check for the reviewing host.
    async shortSuggestions({ durationSec, cues }) {
      const lines = cues.map((c) => `[${Math.floor(c.startSec)}s] ${c.text}`).join('\n');
      return ask({
        maxTokens: 3000,
        system:
          'You help people share short videos about AI and software-engineering best practices with colleagues in an internal app. ' +
          'Only use what is actually said in the transcript. Reply with one JSON object and nothing else.',
        user: `A ${Math.round(durationSec)}-second video. Transcript (each line starts with its time in seconds):
${lines}

Return JSON with exactly these keys:
- "title": a clear, specific title of at most 70 characters, no hashtags or emoji.
- "description": 1–3 plain sentences on the tip or practice it shares.
- "tags": 3–5 short lowercase topic tags.
- "coverSec": the second that best shows what the video is about, for its cover image.
- "concerns": things a reviewer should check before it's shown to everyone: possible confidential or client information (client or project names, account numbers, internal hostnames, credentials, personal data), content not about software or AI, or offensive language. Each is one short sentence starting with its time, e.g. "0:12 names a client". [] when there's nothing.`,
      });
    },
  };
}

// Checks and tidies an AI reply against the real episode: times inside the
// episode and snapped to transcript lines, sensible lengths, https links only.
function cleanInsights(raw, { durationSec, cues }) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const str = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
  const inRange = (s) => typeof s === 'number' && Number.isFinite(s) && s >= 0 && s < durationSec;
  // The transcript line at or before a time, so jumps land on a sentence start.
  const snapStart = (s) => [...cues].reverse().find((c) => c.startSec <= s + 0.5)?.startSec ?? 0;
  const snapEnd = (s) => cues.find((c) => c.endSec >= s - 0.5)?.endSec ?? durationSec;
  const list = (v) => (Array.isArray(v) ? v : []);

  const chapters = [];
  const rawChapters = list(r.chapters)
    .filter((c) => str(c?.title, 60) && inRange(c?.startSec))
    .sort((a, b) => a.startSec - b.startSec);
  for (const c of rawChapters) {
    // The first chapter always starts the episode.
    const startSec = chapters.length === 0 ? 0 : Math.round(snapStart(c.startSec));
    if (!chapters.some((x) => x.startSec === startSec)) chapters.push({ startSec, title: str(c.title, 60) });
  }

  const tags = [...new Set(list(r.tags).map((t) => str(t, 30).toLowerCase().replace(/^#+/, '')).filter(Boolean))].slice(0, 8);

  const mentions = [];
  for (const m of list(r.mentions)) {
    const name = str(m?.name, 80);
    if (!name || !inRange(m?.startSec) || mentions.some((x) => x.name.toLowerCase() === name.toLowerCase())) continue;
    const url = typeof m?.url === 'string' && /^https:\/\/[^\s]+$/.test(m.url) ? m.url.slice(0, 300) : null;
    mentions.push({ startSec: Math.round(snapStart(m.startSec)), name, kind: KINDS.includes(m?.kind) ? m.kind : 'concept', url });
  }
  mentions.sort((a, b) => a.startSec - b.startSec);

  const shorts = [];
  for (const s of list(r.shorts)) {
    const title = str(s?.title, 70);
    if (!title || !inRange(s?.startSec)) continue;
    const startSec = snapStart(s.startSec);
    let endSec = Math.min(durationSec, snapEnd(typeof s?.endSec === 'number' ? s.endSec : startSec + 45));
    if (endSec - startSec > 90) endSec = startSec + 90;
    if (endSec - startSec < 10) continue;
    shorts.push({ startSec, endSec, title, why: str(s?.why, 200) });
  }

  // Only names for speakers that are actually in the transcript.
  const present = new Set(cues.map((c) => c.speaker).filter(Number.isInteger));
  const speakers = {};
  for (const [k, v] of Object.entries(r.speakers && typeof r.speakers === 'object' ? r.speakers : {})) {
    const n = Number(String(k).replace(/^S/i, ''));
    const name = str(v, 40);
    if (present.has(n) && name) speakers[n] = name;
  }

  return { summary: str(r.summary, 800), chapters: chapters.slice(0, 12), tags, mentions: mentions.slice(0, 25), shorts: shorts.slice(0, 4), speakers };
}

// Checks and tidies the suggestions for a Short. The cover frame stays
// inside the video; without one it's the middle.
function cleanSuggestions(raw, { durationSec }) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const str = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
  const list = (v) => (Array.isArray(v) ? v : []);
  const cover = typeof r.coverSec === 'number' && Number.isFinite(r.coverSec) && r.coverSec >= 0 && r.coverSec < durationSec ? r.coverSec : durationSec / 2;
  return {
    title: str(r.title, 100),
    description: str(r.description, 500),
    // One word each, like the ones people type: "ai coding" -> "ai-coding".
    tags: [...new Set(list(r.tags).map((t) => str(t, 30).toLowerCase().replace(/^#+/, '').replace(/\s+/g, '-')).filter(Boolean))].slice(0, 5),
    coverSec: Math.round(cover * 10) / 10,
    concerns: list(r.concerns).map((c) => str(c, 200)).filter(Boolean).slice(0, 6),
  };
}

module.exports = { openRouterAi, cleanInsights, cleanSuggestions };
