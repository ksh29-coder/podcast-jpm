const { authorKey } = require('./engagement');

// A person's Activity (in Me): replies to their comments, comments and likes
// on what they posted, hosts' reviews of it, and new episodes. Worked out from
// the comments, likes and posts themselves, so a hidden comment or a deleted
// post drops out on its own. The app groups comments and likes per post.

const DAYS = 30;
const LIMIT = 100;

function createActivity({ db }) {
  // When this person last looked. The first time is now, so someone new
  // doesn't start with a month of unread episodes.
  async function seenAt(userId) {
    const { rows } = await db.query(
      `insert into activity_seen (user_id) values ($1)
       on conflict (user_id) do update set user_id = excluded.user_id returning seen_at`,
      [userId]
    );
    return rows[0].seen_at;
  }

  async function list(userId) {
    const recent = `now() - interval '${DAYS} days'`;
    // The post a comment or like is on, with its title and author.
    const onItem = (alias) => `
      left join episodes e on ${alias}.item_type = 'episode' and e.id = ${alias}.item_id
      left join shorts s on ${alias}.item_type = 'short' and s.id = ${alias}.item_id`;
    const [seen, replies, comments, likes, reviews, episodes] = await Promise.all([
      seenAt(userId),
      // Replies to this person's comments.
      db.query(
        `select c.id, c.item_type, c.item_id, c.user_id, c.author_name, c.body, c.created_at, coalesce(e.title, s.title) as title
         from comments c join comments t on t.id = c.reply_to_id ${onItem('c')}
         where t.user_id = $1 and c.user_id <> $1 and c.status = 'approved' and c.created_at > ${recent}
         order by c.created_at desc limit ${LIMIT}`,
        [userId]
      ),
      // Comments on this person's posts, except replies to them (told above).
      db.query(
        `select c.id, c.item_type, c.item_id, c.user_id, c.author_name, c.body, c.created_at, coalesce(e.title, s.title) as title
         from comments c left join comments t on t.id = c.reply_to_id ${onItem('c')}
         where coalesce(e.author_id, s.author_id) = $1 and c.user_id <> $1 and c.status = 'approved'
           and (t.user_id is null or t.user_id <> $1) and c.created_at > ${recent}
         order by c.created_at desc limit ${LIMIT}`,
        [userId]
      ),
      db.query(
        `select l.item_type, l.item_id, l.user_id, l.created_at, coalesce(e.title, s.title) as title
         from likes l ${onItem('l')}
         where coalesce(e.author_id, s.author_id) = $1 and l.user_id <> $1 and l.created_at > ${recent}
         order by l.created_at desc limit ${LIMIT}`,
        [userId]
      ),
      // Hosts' decisions on this person's posts.
      db.query(
        `select * from (
           select 'short' as item_type, id as item_id, title, status, review_note, published_at, updated_at from shorts where author_id = $1
           union all
           select 'episode', id, title, status, review_note, published_at, updated_at from episodes where author_id = $1
         ) p
         where (status = 'published' and published_at <= now() and published_at > ${recent})
            or (status = 'rejected' and updated_at > ${recent})`,
        [userId]
      ),
      db.query(
        `select id, title, published_at from episodes
         where status = 'published' and published_at <= now() and published_at > ${recent} and author_id is distinct from $1
         order by published_at desc limit 20`,
        [userId]
      ),
    ]);

    const iso = (t) => new Date(t).toISOString();
    const comment = (kind) => (r) => ({
      id: `${kind}:${r.id}`,
      kind,
      itemType: r.item_type,
      itemId: r.item_id,
      itemTitle: r.title,
      commentId: r.id,
      actorName: r.author_name,
      actorKey: authorKey(r.user_id),
      body: r.body,
      at: iso(r.created_at),
    });
    const items = [
      ...replies.rows.map(comment('reply')),
      ...comments.rows.map(comment('comment')),
      ...likes.rows.map((r) => ({
        id: `like:${r.item_type}:${r.item_id}:${r.user_id}`,
        kind: 'like',
        itemType: r.item_type,
        itemId: r.item_id,
        itemTitle: r.title,
        actorKey: authorKey(r.user_id),
        at: iso(r.created_at),
      })),
      ...reviews.rows.map((r) => ({
        id: `${r.status}:${r.item_id}`,
        kind: r.status === 'published' ? 'live' : 'rejected',
        itemType: r.item_type,
        itemId: r.item_id,
        itemTitle: r.title,
        ...(r.status === 'rejected' && { note: r.review_note }),
        at: iso(r.status === 'published' ? r.published_at : r.updated_at),
      })),
      ...episodes.rows.map((r) => ({ id: `episode:${r.id}`, kind: 'episode', itemType: 'episode', itemId: r.id, itemTitle: r.title, at: iso(r.published_at) })),
    ].sort((a, b) => b.at.localeCompare(a.at));
    return { seenAt: iso(seen), items };
  }

  async function markSeen(userId) {
    await db.query(
      `insert into activity_seen (user_id) values ($1) on conflict (user_id) do update set seen_at = now()`,
      [userId]
    );
  }

  return { list, markSeen };
}

module.exports = { createActivity };
