/**
 * routes/users.js
 * Add this file to your phonics-api repo at: routes/users.js
 * Then in server.js add:
 *   const usersRouter = require('./routes/users');
 *   app.use('/api/users', usersRouter);
 */

const express = require('express');
const { query, useMemory, memDB, getMemNextId } = require('../db/init');

const router = express.Router();

// POST /api/users/register
// Called by phonics-app when a parent signs up (before Stripe checkout)
router.post('/register', async (req, res) => {
  const { email, child_name, child_age } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });

  try {
    if (useMemory()) {
      const existing = memDB.users.find(u => u.email === email);
      if (existing) {
        // Update last_seen and child info if provided
        if (child_name) existing.child_name = child_name;
        if (child_age)  existing.child_age  = child_age;
        existing.last_seen = new Date().toISOString();
        return res.json({ ok: true, data: existing, created: false });
      }
      const user = {
        id: getMemNextId('users'),
        email, child_name, child_age,
        status: 'free',
        created_at: new Date().toISOString(),
        last_seen:  new Date().toISOString(),
      };
      memDB.users.push(user);
      return res.status(201).json({ ok: true, data: user, created: true });
    }

    // Upsert: insert or update last_seen + child info
    const { rows } = await query(
      `INSERT INTO users (email, child_name, child_age, status)
       VALUES ($1, $2, $3, 'free')
       ON CONFLICT (email) DO UPDATE SET
         child_name = COALESCE(EXCLUDED.child_name, users.child_name),
         child_age  = COALESCE(EXCLUDED.child_age,  users.child_age),
         last_seen  = NOW()
       RETURNING id, email, child_name, child_age, status, created_at, last_seen`,
      [email, child_name || null, child_age || null]
    );
    const created = rows[0].created_at > new Date(Date.now() - 2000).toISOString();
    res.status(created ? 201 : 200).json({ ok: true, data: rows[0], created });
  } catch (err) {
    console.error('[users.register]', err.message);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// POST /api/users/ping
// Called on every page load to update last_seen (fire-and-forget like events)
router.post('/ping', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.json({ ok: true }); // silent ignore

  try {
    if (useMemory()) {
      const user = memDB.users.find(u => u.email === email);
      if (user) user.last_seen = new Date().toISOString();
      return res.json({ ok: true });
    }

    await query(
      `UPDATE users SET last_seen = NOW() WHERE email = $1`,
      [email]
    );
    res.json({ ok: true });
  } catch (err) {
    // Fire-and-forget — don't fail the client
    res.json({ ok: true });
  }
});

// GET /api/users/me?email=xxx
// Called by phonics-app to check subscription status
router.get('/me', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'email query param required' });

  try {
    if (useMemory()) {
      const user = memDB.users.find(u => u.email === email);
      if (!user) return res.status(404).json({ error: 'User not found' });
      return res.json({ ok: true, data: user });
    }

    const { rows } = await query(
      `SELECT u.id, u.email, u.child_name, u.child_age, u.status, u.created_at, u.last_seen,
              s.stripe_sub_id, s.plan, s.status AS sub_status
       FROM users u
       LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status IN ('active','trialing')
       WHERE u.email = $1
       LIMIT 1`,
      [email]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true, data: rows[0] });
  } catch (err) {
    console.error('[users.me]', err.message);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

module.exports = router;