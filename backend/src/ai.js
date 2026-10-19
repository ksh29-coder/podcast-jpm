// AI help for hosts, through OpenRouter (model from OPENROUTER_MODEL).
// Reads an episode's transcript and suggests a summary, chapters, tags,
// things mentioned, and moments that would make good Shorts. Suggestions
// are checked here and only reach listeners when a host applies them.

const KINDS = ['tool', 'product', 'company', 'person', 'paper', 'concept'];

function openRouterAi({ apiKey = process.env.OPENROUTER_API_KEY, model = process.env.OPENROUTER_MODEL || 'z-ai/glm-5.2' } = {}) {
  return {
    model,
    async episodeInsights({ title, description, durationSec, cues }) {
      if (!apiKey) throw Object.assign(new Error('AI isn’t set up on this server'), { status: 503 });
      const lines = cues.map((c) => `[${Math.floor(c.startSec)}s] ${c.text}`).join('\n');
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'AI Dev Podcast' },
        body: JSON.stringify({
          model,
          response_format: { type: 'json_object' },
          reasoning: { effort: 'low' },
          max_tokens: 8000,
          messages: [
            {
              role: 'system',
              content:
                'You help the hosts of an internal software-engineering podcast. You turn an episode transcript into structured metadata. ' +
                'Only use what is actually said in the transcript. Reply with one JSON object and nothing else.',
            },
            {
              role: 'user',
              content: `Episode title: ${title}
Description: ${description || '(none)'}
Length: ${Math.round(durationSec)} seconds
Transcript (each line starts with its time in seconds):
${lines}

Return JSON with exactly these keys:
- "summary": 2–3 plain sentences describing the episode for a listener.
- "chapters": 3–10 chapters at real topic changes, [{"startSec": number, "title": string (max 60 chars)}], the first at 0. Fewer for very short episodes.
- "tags": 3–8 short lowercase topic tags.
- "mentions": tools, products, companies, people, papers or concepts that are explicitly named, [{"startSec": number, "name": string, "kind": one of ${KINDS.join(', ')}, "url": official https homepage if you are certain, else null}].
- "shorts": 1–4 self-contained moments of 20–90 seconds that would work as standalone vertical clips, [{"startSec": number, "endSec": number, "title": string (max 70 chars), "why": string (one sentence)}].`,
            },
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

  return { summary: str(r.summary, 800), chapters: chapters.slice(0, 12), tags, mentions: mentions.slice(0, 25), shorts: shorts.slice(0, 4) };
}

module.exports = { openRouterAi, cleanInsights };
