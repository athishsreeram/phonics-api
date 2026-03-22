/**
 * routes/admin.js
 * Admin authentication + dashboard data endpoints.
 */

const express = require('express');
const jwt     = require('jsonwebtoken');
const { query, useMemory, memDB } = require('../db/init');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// POST /api/admin/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  const adminEmail    = process.env.ADMIN_EMAIL    || 'admin@example.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'changeme';

  if (email !== adminEmail || password !== adminPassword) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const secret = process.env.JWT_SECRET || 'dev-secret-change-in-prod';
  const token  = jwt.sign({ email, role: 'admin' }, secret, { expiresIn: '24h' });
  res.json({ ok: true, token });
});

// GET /api/admin/overview
router.get('/overview', requireAdmin, async (_req, res) => {
  try {
    if (useMemory()) {
      return res.json({
        ok: true,
        source: 'memory',
        data: {
          mrr: 0,
          active_subs: 0,
          trialing: 0,
          conversion: 0,
          new_users_today: 0,
          total_events: memDB.events.length,
          total_emails: memDB.emails.length,
          total_stories: memDB.stories.filter(s => s.active).length,
        },
      });
    }

    const [subs, events, emails, users, stories] = await Promise.all([
      query(`SELECT status, COUNT(*) cnt FROM subscriptions GROUP BY status`),
      query(`SELECT COUNT(*) cnt FROM events`),
      query(`SELECT COUNT(*) cnt FROM email_leads`),
      query(`SELECT COUNT(*) cnt FROM users WHERE DATE(created_at) = CURRENT_DATE`),
      query(`SELECT COUNT(*) cnt FROM stories WHERE active = TRUE`),
    ]);

    const subsMap = {};
    subs.rows.forEach(r => { subsMap[r.status] = parseInt(r.cnt); });

    res.json({
      ok: true,
      data: {
        mrr: (subsMap['active'] || 0) * 9.99,
        active_subs:     subsMap['active']   || 0,
        trialing:        subsMap['trialing'] || 0,
        conversion:      0,
        new_users_today: parseInt(users.rows[0].cnt),
        total_events:    parseInt(events.rows[0].cnt),
        total_emails:    parseInt(emails.rows[0].cnt),
        total_stories:   parseInt(stories.rows[0].cnt),
      },
    });
  } catch (err) {
    console.error('[admin.overview]', err.message);
    res.status(500).json({ error: 'Failed to fetch overview' });
  }
});

// GET /api/admin/users
router.get('/users', requireAdmin, async (_req, res) => {
  try {
    if (useMemory()) {
      return res.json({ ok: true, data: memDB.users, source: 'memory' });
    }
    const { rows } = await query(
      `SELECT id, email, child_name, child_age, status, created_at, last_seen
       FROM users ORDER BY created_at DESC LIMIT 100`
    );
    res.json({ ok: true, data: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET /api/admin/events
router.get('/events', requireAdmin, async (_req, res) => {
  try {
    if (useMemory()) {
      return res.json({ ok: true, data: memDB.events.slice(-50).reverse(), source: 'memory' });
    }
    const { rows } = await query(
      `SELECT id, type, session, url, premium, ts, created_at
       FROM events ORDER BY created_at DESC LIMIT 100`
    );
    res.json({ ok: true, data: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// GET /api/admin/emails
router.get('/emails', requireAdmin, async (_req, res) => {
  try {
    if (useMemory()) {
      return res.json({ ok: true, data: memDB.emails, source: 'memory' });
    }
    const { rows } = await query(
      `SELECT id, email, name, source, created_at FROM email_leads ORDER BY created_at DESC`
    );
    res.json({ ok: true, data: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

// GET /api/admin/timeseries?days=30
router.get('/timeseries', requireAdmin, async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 90);
  try {
    if (useMemory()) {
      return res.json({ ok: true, data: [], source: 'memory' });
    }
    const { rows } = await query(
      `SELECT DATE(created_at) AS date, type, COUNT(*) cnt
       FROM events
       WHERE created_at >= NOW() - INTERVAL '${days} days'
       GROUP BY DATE(created_at), type
       ORDER BY date ASC`
    );
    res.json({ ok: true, data: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch timeseries' });
  }
});

module.exports = router;
