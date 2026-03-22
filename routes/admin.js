// routes/admin.js — protected analytics endpoints for the admin dashboard
const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const db      = require('../db');
const { requireAdmin } = require('../middleware/auth');

// POST /api/admin/login
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (email !== process.env.ADMIN_EMAIL || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ role: 'admin', email }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, email });
});

// GET /api/admin/overview — KPI summary
router.get('/overview', requireAdmin, async (req, res) => {
  try {
    const [users, events, leads, subs, activity] = await Promise.all([
      db.query(`SELECT
        COUNT(*)                                                   AS total_users,
        COUNT(*) FILTER (WHERE is_premium)                        AS premium_users,
        COUNT(*) FILTER (WHERE onboarded_at IS NOT NULL)          AS onboarded,
        COUNT(*) FILTER (WHERE email IS NOT NULL)                 AS has_email,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24h') AS new_today,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7d')  AS new_this_week
        FROM users`),

      db.query(`SELECT
        COUNT(*)                                                      AS total_events,
        COUNT(*) FILTER (WHERE type='page_view')                     AS page_views,
        COUNT(*) FILTER (WHERE type='activity_start')                AS activity_starts,
        COUNT(*) FILTER (WHERE type='activity_complete')             AS activity_completes,
        COUNT(*) FILTER (WHERE type='paywall_hit')                   AS paywall_hits,
        COUNT(*) FILTER (WHERE type='upgrade_click')                 AS upgrade_clicks,
        COUNT(*) FILTER (WHERE type='email_captured')                AS email_events,
        COUNT(*) FILTER (WHERE ts > NOW() - INTERVAL '24h')         AS events_today,
        COUNT(DISTINCT session_id) FILTER (WHERE ts > NOW() - INTERVAL '24h') AS active_today,
        COUNT(DISTINCT session_id) FILTER (WHERE ts > NOW() - INTERVAL '7d')  AS active_week
        FROM events`),

      db.query(`SELECT COUNT(*) AS total_leads FROM email_leads`),

      db.query(`SELECT
        COUNT(*) FILTER (WHERE status IN ('active','trialing')) AS active_subs,
        COUNT(*) FILTER (WHERE status='trialing')               AS trialing,
        COUNT(*) FILTER (WHERE status='canceled')               AS canceled,
        COALESCE(SUM(amount) FILTER (WHERE status='active'), 0) AS mrr_cents
        FROM subscriptions`),

      db.query(`SELECT activity_id, COUNT(*) AS plays,
        ROUND(AVG(best_pct)) AS avg_pct
        FROM activity_progress
        GROUP BY activity_id ORDER BY plays DESC LIMIT 10`),
    ]);

    const s  = subs.rows[0];
    const u  = users.rows[0];
    const ev = events.rows[0];
    const totalUsers = parseInt(u.total_users) || 0;
    const paywallHits  = parseInt(ev.paywall_hits) || 0;
    const upgradeClicks = parseInt(ev.upgrade_clicks) || 0;

    res.json({
      users: {
        total:       parseInt(u.total_users),
        premium:     parseInt(u.premium_users),
        onboarded:   parseInt(u.onboarded),
        hasEmail:    parseInt(u.has_email),
        newToday:    parseInt(u.new_today),
        newThisWeek: parseInt(u.new_this_week),
      },
      events: {
        total:             parseInt(ev.total_events),
        pageViews:         parseInt(ev.page_views),
        activityStarts:    parseInt(ev.activity_starts),
        activityCompletes: parseInt(ev.activity_completes),
        paywallHits,
        upgradeClicks,
        emailEvents:       parseInt(ev.email_events),
        eventsToday:       parseInt(ev.events_today),
        activeToday:       parseInt(ev.active_today),
        activeWeek:        parseInt(ev.active_week),
      },
      emailLeads: parseInt(leads.rows[0].total_leads),
      subscriptions: {
        active:    parseInt(s.active_subs),
        trialing:  parseInt(s.trialing),
        canceled:  parseInt(s.canceled),
        mrrCents:  parseInt(s.mrr_cents),
        mrr:       (parseInt(s.mrr_cents) / 100).toFixed(2),
      },
      funnel: {
        visitors:      parseInt(ev.page_views),
        onboarded:     parseInt(u.onboarded),
        emailsCaptured:parseInt(u.has_email),
        paywallHits,
        upgradeClicks,
        subscribers:   parseInt(s.active_subs),
        conversionPct: totalUsers > 0 ? ((parseInt(s.active_subs) / totalUsers) * 100).toFixed(1) : '0',
      },
      topActivities: activity.rows,
    });
  } catch (err) {
    console.error('Overview error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/users?limit=50&offset=0&premium=true
router.get('/users', requireAdmin, async (req, res) => {
  const limit   = Math.min(parseInt(req.query.limit)  || 50, 200);
  const offset  = parseInt(req.query.offset) || 0;
  const premium = req.query.premium;
  try {
    let where = premium === 'true' ? 'WHERE is_premium=true' : premium === 'false' ? 'WHERE is_premium=false' : '';
    const rows = await db.query(`
      SELECT u.id, u.session_id, u.child_name, u.child_age, u.email,
             u.is_premium, u.goals, u.onboarded_at, u.created_at, u.last_seen_at,
             COUNT(e.id) AS event_count,
             COUNT(ap.id) AS activities_completed
      FROM users u
      LEFT JOIN events e           ON e.session_id = u.session_id
      LEFT JOIN activity_progress ap ON ap.session_id = u.session_id AND ap.attempts > 0
      ${where}
      GROUP BY u.id
      ORDER BY u.last_seen_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    const countRow = await db.query(`SELECT COUNT(*) FROM users ${where}`);
    res.json({ users: rows.rows, total: parseInt(countRow.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/events?limit=100&type=upgrade_click
router.get('/events', requireAdmin, async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit) || 100, 500);
  const type   = req.query.type;
  try {
    const rows = await db.query(`
      SELECT e.*, u.child_name, u.child_age
      FROM events e
      LEFT JOIN users u ON u.session_id = e.session_id
      ${type ? 'WHERE e.type=$2' : ''}
      ORDER BY e.ts DESC LIMIT $1
    `, type ? [limit, type] : [limit]);
    res.json({ events: rows.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/emails
router.get('/emails', requireAdmin, async (req, res) => {
  try {
    const rows = await db.query(`SELECT * FROM email_leads ORDER BY created_at DESC LIMIT 500`);
    res.json({ leads: rows.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/timeseries?days=30
router.get('/timeseries', requireAdmin, async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 90);
  try {
    const rows = await db.query(`
      SELECT
        DATE(ts) AS date,
        COUNT(*) FILTER (WHERE type='page_view')        AS views,
        COUNT(*) FILTER (WHERE type='activity_start')   AS starts,
        COUNT(*) FILTER (WHERE type='activity_complete') AS completes,
        COUNT(*) FILTER (WHERE type='paywall_hit')      AS paywall,
        COUNT(*) FILTER (WHERE type='upgrade_click')    AS upgrades,
        COUNT(DISTINCT session_id)                       AS sessions
      FROM events
      WHERE ts > NOW() - ($1 || ' days')::INTERVAL
      GROUP BY DATE(ts)
      ORDER BY date ASC
    `, [days]);
    res.json({ series: rows.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
