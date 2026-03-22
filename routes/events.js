/**
 * routes/events.js
 * Fire-and-forget event logging from phonics-app.
 */

const express = require('express');
const { query, useMemory, memDB, getMemNextId } = require('../db/init');

const router = express.Router();

// POST /api/events
router.post('/', async (req, res) => {
  const { type, session, url, ua, premium = false, ts, data } = req.body;

  if (!type) return res.status(400).json({ error: 'type is required' });

  try {
    if (useMemory()) {
      memDB.events.push({
        id: getMemNextId('events'),
        type, session, url, ua, premium, ts, data,
        created_at: new Date().toISOString(),
      });
      return res.json({ ok: true });
    }

    await query(
      `INSERT INTO events (type, session, url, ua, premium, ts, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [type, session, url, ua, premium, ts, data ? JSON.stringify(data) : null]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[events.post]', err.message);
    res.status(500).json({ error: 'Failed to log event' });
  }
});

module.exports = router;
