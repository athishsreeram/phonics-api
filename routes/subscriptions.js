// routes/subscriptions.js — Stripe checkout + webhook + verify
const express = require('express');
const router  = express.Router();
const db      = require('../db');

let stripe;
try { stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); } catch(e) {}

// POST /api/subscriptions/checkout — create Stripe Checkout Session
router.post('/checkout', async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });
  const { session_id, successUrl, cancelUrl } = req.body || {};
  const origin = req.headers.origin || 'https://phonics77-app.vercel.app';
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      subscription_data: { trial_period_days: 7 },
      success_url: `${successUrl || origin + '/pages/success.html'}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:   cancelUrl  || origin + '/index.html',
      metadata: { phonics_session_id: session_id || '' },
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/subscriptions/verify?session_id=cs_...
router.get('/verify', async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });
  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: 'Missing session_id' });
  try {
    const session = await stripe.checkout.sessions.retrieve(session_id, { expand: ['subscription'] });
    const active  = ['active','trialing'].includes(session.subscription?.status);

    // Update DB if active
    if (active && session.metadata?.phonics_session_id) {
      const sid = session.metadata.phonics_session_id;
      await db.query(`UPDATE users SET is_premium=true, stripe_customer_id=$1 WHERE session_id=$2`,
        [session.customer, sid]);
      await db.query(`
        INSERT INTO subscriptions (session_id, stripe_customer_id, stripe_sub_id, status, price_id, amount, currency)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (stripe_sub_id) DO UPDATE SET status=EXCLUDED.status, updated_at=NOW()
      `, [sid, session.customer, session.subscription?.id, session.subscription?.status,
          process.env.STRIPE_PRICE_ID, 999, 'cad']);
    }
    res.json({ active, status: session.subscription?.status || 'unknown', customer: session.customer });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/subscriptions/webhook — Stripe webhook (raw body required)
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.status(500).send('Stripe not configured');
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  try {
    const sub = event.data.object;
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const active = ['active','trialing'].includes(sub.status);
        await db.query(`UPDATE users SET is_premium=$1 WHERE stripe_customer_id=$2`, [active, sub.customer]);
        await db.query(`
          INSERT INTO subscriptions (stripe_customer_id, stripe_sub_id, status, updated_at)
          VALUES ($1,$2,$3,NOW())
          ON CONFLICT (stripe_sub_id) DO UPDATE SET status=EXCLUDED.status, updated_at=NOW()
        `, [sub.customer, sub.id, sub.status]);
        break;
      }
      case 'customer.subscription.deleted': {
        await db.query(`UPDATE users SET is_premium=false WHERE stripe_customer_id=$1`, [sub.customer]);
        await db.query(`UPDATE subscriptions SET status='canceled', canceled_at=NOW(), updated_at=NOW() WHERE stripe_sub_id=$1`, [sub.id]);
        break;
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
