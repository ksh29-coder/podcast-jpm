const crypto = require('crypto');
const express = require('express');
const { ITEM_TYPES } = require('./db');
const { httpError } = require('./store');

// Likes, views and comments on episodes and Shorts. Viewers are identified by
// req.user (a device id until sign-in exists).

const TABLE = { episode: 'episodes', short: 'shorts' };
const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function createEngagement({ db, push, later }) {
  // Counts for many items at once, plus whether this user liked each.
  async function stats(type, ids, userId) {
    if (!ids.length) return new Map();
    const [likes, views, comments] = await Promise.all([
      db.query(
        `select item_id, count(*)::int as n, bool_or(user_id = $3) as mine from likes
         where item_type = $1 and item_id = any($2) group by item_id`,
        [type, ids, userId]
      ),
      db.query(`select item_id, count(*)::int as n from views where item_type = $1 and item_id = any($2) group by item_id`, [type, ids]),
      db.query(
        `select item_id, count(*)::int as n from comments where item_type = $1 and item_id = any($2) and status = 'approved' group by item_id`,
        [type, ids]
      ),
    ]);
    const by = (rows) => new Map(rows.map((r) => [r.item_id, r]));
    const l = by(likes.rows);
    const v = by(views.rows);
    const c = by(comments.rows);
    return new Map(
      ids.map((id) => [id, { likes: l.get(id)?.n ?? 0, liked: !!l.get(id)?.mine, views: v.get(id)?.n ?? 0, comments: c.get(id)?.n ?? 0 }])
    );
  }

  async function withStats(type, items, userId) {
    const s = await stats(type, items.map((i) => i.id), userId);
    return items.map((i) => ({ ...i, ...s.get(i.id) }));
  }

  async function requirePublished(type, id) {
    if (!ITEM_TYPES.includes(type)) throw httpError(404, 'Not found');
    const { rows } = await db.query(`select 1 from ${TABLE[type]} where id = $1 and status = 'published' and published_at <= now()`, [id]);
    if (!rows[0]) throw httpError(404, `${type === 'episode' ? 'Episode' : 'Short'} not found`);
  }

  function router() {
    const r = express.Router();

    r.put(
      '/:type/:id/like',
      ah(async (req, res) => {
        const { type, id } = req.params;
        await requirePublished(type, id);
        await db.query('insert into likes (item_type, item_id, user_id) values ($1, $2, $3) on conflict do nothing', [type, id, req.user.id]);
        res.json((await stats(type, [id], req.user.id)).get(id));
      })
    );

    r.delete(
      '/:type/:id/like',
      ah(async (req, res) => {
        const { type, id } = req.params;
        await requirePublished(type, id);
        await db.query('delete from likes where item_type = $1 and item_id = $2 and user_id = $3', [type, id, req.user.id]);
        res.json((await stats(type, [id], req.user.id)).get(id));
      })
    );

    r.post(
      '/:type/:id/view',
      ah(async (req, res) => {
        const { type, id } = req.params;
        await requirePublished(type, id);
        await db.query('insert into views (item_type, item_id, user_id) values ($1, $2, $3) on conflict do nothing', [type, id, req.user.id]);
        res.status(204).end();
      })
    );

    // Comments people can see, plus this person's own hidden ones (reported,
    // waiting for a host) so they know why others can't.
    r.get(
      '/:type/:id/comments',
      ah(async (req, res) => {
        const { type, id } = req.params;
        await requirePublished(type, id);
        // Replies come with the thread they're in (parentId), and the name
        // they answer when that's another reply rather than the thread's start.
        const { rows } = await db.query(
          `select c.id, c.author_name, c.body, c.status, c.created_at, c.at_sec, c.user_id, c.user_id = $3 as mine, c.parent_id,
                  case when c.reply_to_id <> c.parent_id then t.author_name end as reply_to_name
           from comments c left join comments t on t.id = c.reply_to_id
           where c.item_type = $1 and c.item_id = $2 and (c.status = 'approved' or (c.status = 'pending' and c.user_id = $3))
           order by c.created_at desc limit 500`,
          [type, id, req.user.id]
        );
        res.json(rows.map(toComment));
      })
    );

    r.post(
      '/:type/:id/comments',
      ah(async (req, res) => {
        const { type, id } = req.params;
        await requirePublished(type, id);
        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
        if (!name || name.length > 50) throw httpError(400, 'Add your name (up to 50 characters)');
        if (!body || body.length > 1000) throw httpError(400, 'Comments can be 1 to 1000 characters');
        const at = req.body?.atSec;
        if (at !== undefined && at !== null && (typeof at !== 'number' || !Number.isFinite(at) || at < 0 || at > 24 * 3600)) {
          throw httpError(400, 'atSec must be a time in seconds');
        }
        // A reply goes in the thread of the comment it answers.
        let target = null;
        if (req.body?.replyTo !== undefined && req.body?.replyTo !== null) {
          if (typeof req.body.replyTo !== 'string') throw httpError(400, 'replyTo must be a comment id');
          const found = await db.query(
            "select id, parent_id, author_name from comments where id = $1 and item_type = $2 and item_id = $3 and status = 'approved'",
            [req.body.replyTo, type, id]
          );
          target = found.rows[0];
          if (!target) throw httpError(404, 'That comment isn’t there any more');
        }
        const parentId = target ? (target.parent_id ?? target.id) : null;
        const commentId = `cm_${crypto.randomBytes(6).toString('hex')}`;
        const { rows } = await db.query(
          `insert into comments (id, item_type, item_id, user_id, author_name, body, at_sec, status, parent_id, reply_to_id)
           values ($1, $2, $3, $4, $5, $6, $7, 'approved', $8, $9)
           returning id, author_name, body, status, created_at, at_sec, user_id, true as mine, parent_id`,
          [commentId, type, id, req.user.id, name, body, target ? null : typeof at === 'number' ? Math.round(at) : null, parentId, target?.id ?? null]
        );
        // Phone alerts for whoever it answers, or the post's author.
        if (push) later(push.commentPosted(commentId));
        const replyToName = target && target.id !== parentId ? target.author_name : null;
        res.status(201).json(toComment({ ...rows[0], reply_to_name: replyToName }));
      })
    );

    // Report an episode or Short. Something posted from the app or website is
    // hidden straight away and goes back to the hosts' review queue; a host's
    // own episode or Short stays up, flagged for them.
    r.post(
      '/:type/:id/report',
      ah(async (req, res) => {
        const { type, id } = req.params;
        await requirePublished(type, id);
        const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
        await db.query(
          `insert into content_reports (item_type, item_id, user_id, reason) values ($1, $2, $3, $4)
           on conflict (item_type, item_id, user_id) do update set reason = excluded.reason, created_at = now()`,
          [type, id, req.user.id, reason]
        );
        await db.query(`update ${TABLE[type]} set status = 'in_review', updated_at = now() where id = $1 and author_id is not null`, [id]);
        res.status(204).end();
      })
    );

    // Report a comment. It's hidden straight away and goes back to the hosts'
    // review queue with the reason.
    r.post(
      '/:type/:id/comments/:commentId/report',
      ah(async (req, res) => {
        const { type, id, commentId } = req.params;
        await requirePublished(type, id);
        const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
        const { rowCount } = await db.query('select 1 from comments where id = $1 and item_type = $2 and item_id = $3', [commentId, type, id]);
        if (!rowCount) throw httpError(404, 'Comment not found');
        await db.query(
          `insert into comment_reports (comment_id, user_id, reason) values ($1, $2, $3)
           on conflict (comment_id, user_id) do update set reason = excluded.reason, created_at = now()`,
          [commentId, req.user.id, reason]
        );
        await db.query("update comments set status = 'pending' where id = $1 and status = 'approved'", [commentId]);
        res.status(204).end();
      })
    );

    return r;
  }

  // ---- Host side: the review queue ----

  async function hostComments(status) {
    const { rows } = await db.query(
      `select c.id, c.item_type, c.item_id, c.author_name, c.body, c.status, c.created_at, c.at_sec,
              coalesce(e.title, s.title) as item_title,
              (select coalesce(json_agg(r.reason order by r.created_at), '[]') from comment_reports r where r.comment_id = c.id) as reports
       from comments c
       left join episodes e on c.item_type = 'episode' and e.id = c.item_id
       left join shorts s on c.item_type = 'short' and s.id = c.item_id
       where c.status = $1 order by c.created_at asc limit 200`,
      [status]
    );
    return rows.map((r) => ({
      ...toComment(r),
      itemType: r.item_type,
      itemId: r.item_id,
      itemTitle: r.item_title,
      // Reasons given by viewers who reported it ('' when they gave none).
      reports: typeof r.reports === 'string' ? JSON.parse(r.reports) : r.reports || [],
    }));
  }

  async function setCommentStatus(id, status) {
    if (!['pending', 'approved', 'rejected'].includes(status)) throw httpError(400, 'status must be pending, approved or rejected');
    const { rowCount } = await db.query('update comments set status = $2 where id = $1', [id, status]);
    if (!rowCount) throw httpError(404, 'Comment not found');
  }

  return { router, withStats, hostComments, setCommentStatus };
}

// Lets a viewer block someone without learning who (or which device) they are.
const authorKey = (userId) => crypto.createHash('sha256').update(`author:${userId}`).digest('hex').slice(0, 16);

function toComment(r) {
  return {
    id: r.id,
    authorName: r.author_name,
    body: r.body,
    status: r.status,
    createdAt: new Date(r.created_at).toISOString(),
    atSec: r.at_sec ?? null,
    ...(r.parent_id !== undefined && { parentId: r.parent_id ?? null, replyToName: r.reply_to_name ?? null }),
    ...(r.user_id !== undefined && { authorKey: authorKey(r.user_id) }),
    ...(r.mine !== undefined && { mine: r.mine }),
  };
}

module.exports = { createEngagement, authorKey };
