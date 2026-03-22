// routes/events.js — receive events from phonics app, upsert user
const express = require('express');
const router  = express.Router();
const db      = require('../db');

// POST /api/events — called by js/analytics.js in the phonics app
router.post('/', async (req, res) => {
  const { type, session, url, ua, premium, ts, ...data } = req.body || {};
  if (!type || !session) return res.status(400).json({ error: 'Missing type or session' });

  try {
    // Upsert user row keyed by session_id
    await db.query(`
      INSERT INTO users (session_id, is_premium, last_seen_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (session_id) DO UPDATE
        SET is_premium   = EXCLUDED.is_premium,
            last_seen_at = NOW()
    `, [session, !!premium]);

    // Get user id
    const userRow = await db.query('SELECT id FROM users WHERE session_id=$1', [session]);
    const userId  = userRow.rows[0]?.id || null;

    // Insert event
    await db.query(`
      INSERT INTO events (session_id, user_id, type, data, url, ua, is_premium, ts)
      VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8::bigint / 1000.0))
    `, [session, userId, type, JSON.stringify(data), url || '', ua || '', !!premium, ts || Date.now()]);

    // Handle specific event types
    if (type === 'signup') {
      const { childName, childAge } = data;
      if (childName || childAge) {
        await db.query(`
          UPDATE users SET child_name=$1, child_age=$2, onboarded_at=NOW()
          WHERE session_id=$3
        `, [childName || null, childAge || null, session]);
      }
    }

    if (type === 'activity_complete') {
      const { activityId, score, total, pct } = data;
      if (activityId) {
        await db.query(`
          INSERT INTO activity_progress (session_id, user_id, activity_id, attempts, best_score, best_pct, last_score, last_pct, updated_at)
          VALUES ($1, $2, $3, 1, $4, $5, $4, $5, NOW())
          ON CONFLICT (session_id, activity_id) DO UPDATE
            SET attempts   = activity_progress.attempts + 1,
                last_score = $4,
                last_pct   = $5,
                best_score = GREATEST(activity_progress.best_score, $4),
                best_pct   = GREATEST(activity_progress.best_pct, $5),
                updated_at = NOW()
        `, [session, userId, activityId, score || 0, pct || 0]);
      }
    }

    if (type === 'streak_milestone') {
      const { days } = data;
      await db.query(`
        INSERT INTO streaks (session_id, count, longest, last_date, updated_at)
        VALUES ($1, $2, $2, CURRENT_DATE, NOW())
        ON CONFLICT (session_id) DO UPDATE
          SET count     = $2,
              longest   = GREATEST(streaks.longest, $2),
              last_date = CURRENT_DATE,
              updated_at = NOW()
      `, [session, days || 1]);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Event error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
