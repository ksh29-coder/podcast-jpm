// Phone alerts, sent through Expo's push service (which passes them to Apple).
// Inside JPM this would send to Apple directly instead.
//
// Replies and comments are sent as they're posted; comments on a post at most
// once every few minutes per person, so a busy post doesn't buzz them for
// each one. Hosts' reviews and new episodes are found by sweep(), which runs
// as the app talks to the server, so scheduled ones go out once they're live.
// Each person chooses which kinds they get (push_settings); the Activity list
// in Me always has everything.

const KINDS = ['replies', 'comments', 'reviews', 'episodes'];
const COMMENT_GAP_MIN = 10;
// Reviews and episodes older than this when the sweep sees them aren't sent.
const SWEEP_HOURS = 24;
const TOKEN = /^Expo(nent)?PushToken\[[^\]]+\]$/;

async function expoSend(messages) {
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(messages),
  });
  if (!res.ok) throw new Error(`Expo push: ${res.status}`);
  return (await res.json()).data;
}

const clip = (text, max = 150) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const what = (type) => (type === 'episode' ? 'episode' : 'Short');

function createPush({ db, send = expoSend }) {
  async function register(userId, token) {
    if (typeof token !== 'string' || !TOKEN.test(token)) return false;
    // A phone moves to whoever uses the app on it now.
    await db.query(
      `insert into push_tokens (token, user_id) values ($1, $2)
       on conflict (token) do update set user_id = excluded.user_id, updated_at = now()`,
      [token, userId]
    );
    return true;
  }

  async function unregister(userId, token) {
    await db.query('delete from push_tokens where token = $1 and user_id = $2', [token, userId]);
  }

  async function settings(userId) {
    const { rows } = await db.query(`select ${KINDS.join(', ')} from push_settings where user_id = $1`, [userId]);
    return Object.fromEntries(KINDS.map((k) => [k, rows[0]?.[k] ?? true]));
  }

  async function saveSettings(userId, changes) {
    const next = { ...(await settings(userId)), ...changes };
    await db.query(
      `insert into push_settings (user_id, ${KINDS.join(', ')}) values ($1, $2, $3, $4, $5)
       on conflict (user_id) do update set ${KINDS.map((k) => `${k} = excluded.${k}`).join(', ')}`,
      [userId, ...KINDS.map((k) => next[k])]
    );
    return next;
  }

  // Phones of these people (or everyone, for null) who want this kind.
  async function tokens(userIds, kind) {
    const { rows } = await db.query(
      `select t.token from push_tokens t left join push_settings s on s.user_id = t.user_id
       where ($1::text[] is null or t.user_id = any($1)) and coalesce(s.${kind}, true)`,
      [userIds]
    );
    return rows.map((r) => r.token);
  }

  async function deliver(to, { title, body, url }) {
    if (!to.length) return;
    for (let i = 0; i < to.length; i += 100) {
      const batch = to.slice(i, i + 100);
      const tickets = await send(batch.map((token) => ({ to: token, title, body: clip(body), data: { url }, sound: 'default' })));
      // Apps that were deleted, or had alerts turned off in Settings.
      const gone = batch.filter((_, j) => tickets?.[j]?.details?.error === 'DeviceNotRegistered');
      if (gone.length) await db.query('delete from push_tokens where token = any($1)', [gone]);
    }
  }

  // Marks an alert as sent; false if it already was (within `withinMin`).
  async function once(key, withinMin) {
    const { rows } = await db.query(
      `insert into push_sent (key) values ($1)
       on conflict (key) do update set sent_at = now()
       ${withinMin ? `where push_sent.sent_at < now() - interval '${withinMin} minutes'` : 'where false'}
       returning key`,
      [key]
    );
    return rows.length > 0;
  }

  // A new comment: tell the person it answers, or else the post's author.
  async function commentPosted(commentId) {
    const { rows } = await db.query(
      `select c.id, c.item_type, c.item_id, c.user_id, c.author_name, c.body, t.user_id as answered,
              coalesce(e.title, s.title) as title, coalesce(e.author_id, s.author_id) as owner
       from comments c left join comments t on t.id = c.reply_to_id
       left join episodes e on c.item_type = 'episode' and e.id = c.item_id
       left join shorts s on c.item_type = 'short' and s.id = c.item_id
       where c.id = $1 and c.status = 'approved'`,
      [commentId]
    );
    const c = rows[0];
    if (!c) return;
    const url = `/comments/${c.item_type}/${c.item_id}?focus=${c.id}`;
    if (c.answered && c.answered !== c.user_id) {
      await deliver(await tokens([c.answered], 'replies'), { title: `${c.author_name} replied to your comment`, body: c.body, url });
    }
    if (c.owner && c.owner !== c.user_id && c.owner !== c.answered && (await once(`comments:${c.item_type}:${c.item_id}`, COMMENT_GAP_MIN))) {
      await deliver(await tokens([c.owner], 'comments'), {
        title: `${c.author_name} commented on your ${what(c.item_type)}`,
        body: `“${c.title}”: ${c.body}`,
        url,
      });
    }
  }

  // Hosts' reviews of posts, and new episodes, not sent yet.
  async function sweep() {
    // Nothing from before anyone could get alerts (the first phone signed up).
    const since = `greatest(now() - interval '${SWEEP_HOURS} hours', (select coalesce(min(created_at), now()) from push_tokens))`;
    const { rows: reviews } = await db.query(
      `select * from (
         select 'short' as item_type, id, title, status, review_note, author_id, published_at, updated_at from shorts where author_id is not null
         union all
         select 'episode', id, title, status, review_note, author_id, published_at, updated_at from episodes where author_id is not null
       ) p
       where (status = 'published' and published_at <= now() and published_at > ${since})
          or (status = 'rejected' and updated_at > ${since})`
    );
    for (const p of reviews) {
      const live = p.status === 'published';
      if (!(await once(`${p.status}:${p.item_type}:${p.id}`))) continue;
      await deliver(await tokens([p.author_id], 'reviews'), {
        title: live ? `Your ${what(p.item_type)} is live` : `Your ${what(p.item_type)} wasn’t approved`,
        body: live ? `“${p.title}”` : p.review_note || `“${p.title}”`,
        url: live ? (p.item_type === 'episode' ? `/episode/${p.id}` : `/shorts?id=${p.id}`) : `/my-short/${p.id}`,
      });
    }
    const { rows: episodes } = await db.query(
      `select id, title, author_id from episodes where status = 'published' and published_at <= now() and published_at > ${since}`
    );
    for (const e of episodes) {
      if (!(await once(`episode:${e.id}`))) continue;
      const to = (await tokens(null, 'episodes')).filter(Boolean);
      // Not to whoever posted it: they're told it's live.
      const mine = e.author_id ? new Set(await tokens([e.author_id], 'episodes')) : new Set();
      await deliver(
        to.filter((t) => !mine.has(t)),
        { title: 'New episode', body: e.title, url: `/episode/${e.id}` }
      );
    }
  }

  // At most once a minute per server, since it runs as the app is used.
  let lastSweep = 0;
  function sweepSoon() {
    if (Date.now() - lastSweep < 60_000) return null;
    lastSweep = Date.now();
    return sweep();
  }

  return { KINDS, register, unregister, settings, saveSettings, commentPosted, sweep, sweepSoon };
}

module.exports = { createPush };
