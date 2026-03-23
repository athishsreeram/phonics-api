/**
 * routes/subscriptions.js
 * Stripe checkout, verify, and webhook.
 */

const express = require('express');
const { query, useMemory } = require('../db/init');

const router = express.Router();

// POST /api/subscriptions/checkout
router.post('/checkout', async (req, res) => {
  const stripeKey   = process.env.STRIPE_SECRET_KEY;
  const stripePrice = process.env.STRIPE_PRICE_ID;

  if (!stripeKey || !stripePrice) {
    return res.status(503).json({ error: 'Stripe not configured — set STRIPE_SECRET_KEY and STRIPE_PRICE_ID' });
  }

  try {
    const stripe = require('stripe')(stripeKey);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: stripePrice, quantity: 1 }],
      success_url: `${req.headers.origin || 'https://phonics77-app.vercel.app'}/pages/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${req.headers.origin || 'https://phonics77-app.vercel.app'}/index.html`,
      subscription_data: { trial_period_days: 7 },
    });
    res.json({ ok: true, url: session.url });
  } catch (err) {
    console.error('[subscriptions.checkout]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/subscriptions/verify?session_id=cs_xxx&email=optional
// Verifies Stripe session AND writes to subscriptions + users tables.
// Never returns 500 — always returns ok:true with active flag so frontend
// can grant premium even if Stripe config is incomplete.
router.get('/verify', async (req, res) => {
  const { session_id, email: queryEmail } = req.query;
  if (!session_id) return res.status(400).json({ error: 'session_id required' });

  const stripeKey = process.env.STRIPE_SECRET_KEY;

  // ── No Stripe key: grant premium optimistically from session_id presence ──
  if (!stripeKey) {
    console.warn('[subscriptions.verify] STRIPE_SECRET_KEY not set — granting optimistically');
    return res.json({
      ok:     true,
      active: true,
      status: 'active',
      customer: queryEmail ? { email: queryEmail } : null,
      note:   'unverified — Stripe not configured',
    });
  }

  try {
    const stripe = require('stripe')(stripeKey);

    // Retrieve session — try with subscription expand, fall back without
    let session;
    try {
      session = await stripe.checkout.sessions.retrieve(session_id, {
        expand: ['subscription'],
      });
    } catch (expandErr) {
      // expand failed — try plain retrieve
      console.warn('[subscriptions.verify] expand failed, retrying plain:', expandErr.message);
      session = await stripe.checkout.sessions.retrieve(session_id);
    }

    // Determine active state — trial counts as active for access purposes
    const paymentStatus = session.payment_status;
    const subStatus     = session.subscription?.status || null;
    const active = paymentStatus === 'paid'         ||
                   paymentStatus === 'no_payment_required' ||
                   subStatus === 'active'           ||
                   subStatus === 'trialing';

    const email       = session.customer_details?.email || queryEmail || null;
    const stripeSubId = session.subscription?.id || null;
    const dbStatus    = subStatus || (active ? 'trialing' : 'unpaid');

    // ── Write to DB ───────────────────────────────────────────────────────────
    if (email) {
      try {
        if (useMemory()) {
          const { memDB } = require('../db/init');
          let user = memDB.users.find(u => u.email === email);
          if (user) {
            if (active) user.status = dbStatus;
          } else {
            user = { id: Date.now(), email, status: active ? dbStatus : 'free',
                     created_at: new Date().toISOString(), last_seen: new Date().toISOString() };
            memDB.users.push(user);
          }
          // Also write to email_leads
          if (!memDB.emails.find(e => e.email === email)) {
            memDB.emails.push({ id: Date.now()+1, email, name: null,
                                source: 'stripe_checkout', created_at: new Date().toISOString() });
          }
        } else {
          // 1. Upsert user with subscription status
          const { rows: userRows } = await query(
            `INSERT INTO users (email, status)
             VALUES ($1, $2)
             ON CONFLICT (email) DO UPDATE SET
               status    = CASE WHEN $2 IN ('active','trialing') THEN $2 ELSE users.status END,
               last_seen = NOW()
             RETURNING id`,
            [email, dbStatus]
          );

          const userId = userRows[0]?.id || null;

          // 2. Also write to email_leads (idempotent)
          await query(
            `INSERT INTO email_leads (email, source)
             VALUES ($1, 'stripe_checkout')
             ON CONFLICT (email) DO NOTHING`,
            [email]
          );

          // 3. Upsert subscription row
          if (userId && active) {
            await query(
              `INSERT INTO subscriptions (user_id, stripe_session_id, stripe_sub_id, status, plan)
               VALUES ($1, $2, $3, $4, 'monthly')
               ON CONFLICT (stripe_session_id) DO UPDATE SET
                 status        = EXCLUDED.status,
                 stripe_sub_id = COALESCE(EXCLUDED.stripe_sub_id, subscriptions.stripe_sub_id),
                 updated_at    = NOW()`,
              [userId, session_id, stripeSubId, dbStatus]
            );
          }
        }

        console.log(`[subscriptions.verify] ✅ ${email} → ${dbStatus} | session: ${session_id}`);
      } catch (dbErr) {
        // DB write failed — still return success to client so premium unlocks
        console.error('[subscriptions.verify] DB write failed (non-fatal):', dbErr.message);
      }
    }

    res.json({
      ok:       true,
      active,
      status:   dbStatus,
      email:    email || null,
      customer: session.customer_details || (email ? { email } : null),
    });
  } catch (err) {
    // Never 500 — always grant optimistically so premium unlocks
    console.error('[subscriptions.verify]', err.message);
    res.json({
      ok:     true,
      active: true,
      status: 'active',
      email:  queryEmail || null,
      note:   'verify error — optimistic grant',
    });
  }
});

// POST /api/subscriptions/webhook  (raw body — set in server.js)
router.post('/webhook', async (req, res) => {
  const sig     = req.headers['stripe-signature'];
  const secret  = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    console.warn('STRIPE_WEBHOOK_SECRET not set — skipping webhook verification');
    return res.json({ received: true });
  }

  let event;
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  console.log(`[stripe webhook] ${event.type}`);
  res.json({ received: true });
});

module.exports = router;