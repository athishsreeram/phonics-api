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
router.get('/verify', async (req, res) => {
  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: 'session_id required' });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(503).json({ error: 'Stripe not configured' });

  try {
    const stripe  = require('stripe')(stripeKey);
    const session = await stripe.checkout.sessions.retrieve(session_id);
    res.json({ ok: true, status: session.payment_status, customer: session.customer_details });
  } catch (err) {
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
