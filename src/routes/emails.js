const express = require('express');
const { query, useMemory, memDB, getMemNextId } = require('../db/init');

const router = express.Router();

// POST /api/emails
router.post('/', async (req, res) => {
  const { email, name, source } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });

  try {
    if (useMemory()) {
      const exists = memDB.emails.find(e => e.email === email);
      if (exists) return res.json({ ok: true, message: 'already captured' });
      memDB.emails.push({ id: getMemNextId('emails'), email, name, source, created_at: new Date().toISOString() });
      return res.json({ ok: true });
    }

    await query(
      `INSERT INTO email_leads (email, name, source)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING`,
      [email, name, source]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[emails.post]', err.message);
    res.status(500).json({ error: 'Failed to capture email' });
  }
});

module.exports = router;
