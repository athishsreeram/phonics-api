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

// GET /api/subscriptions/verify?session_id=cs_xxx
// Verifies Stripe session AND writes to subscriptions + users tables.
router.get('/verify', async (req, res) => {
  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: 'session_id required' });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(503).json({ error: 'Stripe not configured' });

  try {
    const stripe  = require('stripe')(stripeKey);
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['subscription'],
    });

    const active = session.payment_status === 'paid' ||
                   session.subscription?.status === 'active' ||
                   session.subscription?.status === 'trialing';

    const email      = session.customer_details?.email || null;
    const stripeSubId = session.subscription?.id || null;
    const subStatus  = session.subscription?.status || (active ? 'active' : 'unpaid');

    // Write to DB if payment is active
    if (active && email) {
      if (useMemory()) {
        // In-memory: upsert user status
        const { memDB } = require('../db/init');
        const user = memDB.users.find(u => u.email === email);
        if (user) {
          user.status = subStatus;
        } else {
          memDB.users.push({
            id: Date.now(), email, status: subStatus,
            created_at: new Date().toISOString(), last_seen: new Date().toISOString(),
          });
        }
      } else {
        // 1. Upsert user — set status to active/trialing
        const { rows: userRows } = await query(
          `INSERT INTO users (email, status)
           VALUES ($1, $2)
           ON CONFLICT (email) DO UPDATE SET
             status    = EXCLUDED.status,
             last_seen = NOW()
           RETURNING id`,
          [email, subStatus]
        );

        const userId = userRows[0]?.id || null;

        // 2. Upsert subscription row
        if (userId) {
          await query(
            `INSERT INTO subscriptions (user_id, stripe_session_id, stripe_sub_id, status, plan)
             VALUES ($1, $2, $3, $4, 'monthly')
             ON CONFLICT (stripe_session_id) DO UPDATE SET
               status     = EXCLUDED.status,
               stripe_sub_id = COALESCE(EXCLUDED.stripe_sub_id, subscriptions.stripe_sub_id),
               updated_at = NOW()`,
            [userId, session_id, stripeSubId, subStatus]
          );
        }
      }

      console.log(`[subscriptions.verify] ${email} → ${subStatus} (session: ${session_id})`);
    }

    res.json({
      ok:       true,
      active,
      status:   subStatus,
      customer: session.customer_details,
    });
  } catch (err) {
    console.error('[subscriptions.verify]', err.message);
    res.status(500).json({ error: err.message });
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