// routes/emails.js — capture email leads
const express = require('express');
const router  = express.Router();
const db      = require('../db');

// POST /api/emails — called when user submits email in onboarding or capture bar
router.post('/', async (req, res) => {
  const { email, name, source, session_id, profile } = req.body || {};
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Invalid email' });

  try {
    // Upsert email lead
    await db.query(`
      INSERT INTO email_leads (email, name, source, session_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO UPDATE
        SET name       = COALESCE(EXCLUDED.name, email_leads.name),
            source     = COALESCE(EXCLUDED.source, email_leads.source)
    `, [email.toLowerCase().trim(), name || null, source || 'app', session_id || null]);

    // Also update user row
    if (session_id) {
      await db.query(`
        UPDATE users SET email=$1 WHERE session_id=$2
      `, [email.toLowerCase().trim(), session_id]);
    }

    console.log('[EMAIL_LEAD]', email, name, source);

    // ── Mailchimp (uncomment when ready) ──────────────────────────────────
    // const MC_KEY     = process.env.MAILCHIMP_API_KEY;
    // const MC_LIST_ID = process.env.MAILCHIMP_LIST_ID;
    // const MC_DC      = MC_KEY?.split('-')[1];
    // if (MC_KEY && MC_LIST_ID) {
    //   await fetch(`https://${MC_DC}.api.mailchimp.com/3.0/lists/${MC_LIST_ID}/members`, {
    //     method: 'POST',
    //     headers: { 'Authorization': `Basic ${Buffer.from(`any:${MC_KEY}`).toString('base64')}`, 'Content-Type': 'application/json' },
    //     body: JSON.stringify({ email_address: email, status: 'subscribed', merge_fields: { FNAME: name || '' } })
    //   });
    // }

    res.json({ ok: true });
  } catch (err) {
    console.error('Email capture error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
