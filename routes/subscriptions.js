/**
 * src/routes/subscriptions.js
 *
 * Production-ready Stripe subscription flow:
 *   POST /api/subscriptions/checkout         → create Stripe session
 *   GET  /api/subscriptions/verify           → verify session + write DB
 *   GET  /api/subscriptions/status?email=x   → check live subscription status
 *   POST /api/subscriptions/webhook          → handle Stripe events
 */

'use strict';

const express = require('express');
const { query, useMemory, memDB } = require('../db/init');

const router  = express.Router();
const PLAN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days in ms

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not set');
  return require('stripe')(key);
}

/**
 * Compute new expiry using renewal logic:
 *   extend from max(current_expiry, now) + 30 days
 * This means renewing early doesn't lose time.
 */
function computeExpiry(currentExpiry) {
  const base = currentExpiry && new Date(currentExpiry) > new Date()
    ? new Date(currentExpiry)
    : new Date();
  return new Date(base.getTime() + PLAN_MS);
}

// ─── POST /api/subscriptions/checkout ─────────────────────────────────────────
router.post('/checkout', async (req, res) => {
  const priceId = process.env.STRIPE_PRICE_ID;

  try {
    const stripe  = getStripe();
    const origin  = req.headers.origin || 'https://phonics77-app.vercel.app';
    const email   = req.body?.email || null;

    const sessionParams = {
      mode:                 'subscription',
      payment_method_types: ['card'],
      line_items:           [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/pages/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${origin}/index.html`,
      subscription_data: { trial_period_days: 7 },
    };

    // Pre-fill email if we know it — reduces friction
    if (email) sessionParams.customer_email = email;

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ ok: true, url: session.url });

  } catch (err) {
    console.error('[checkout]', err.message);
    // Return a usable error — never leave frontend hanging
    res.status(err.message.includes('not set') ? 503 : 500)
       .json({ error: err.message });
  }
});

// ─── GET /api/subscriptions/verify?session_id=cs_xxx&email=optional ───────────
//
// Called from success.html after Stripe redirect.
// Idempotent: duplicate calls for same session_id are safe.
// Writes to: subscriptions table, users.status, users.stripe_customer_id
//
router.get('/verify', async (req, res) => {
  const { session_id, email: queryEmail } = req.query;
  if (!session_id) return res.status(400).json({ error: 'session_id required' });

  // ── No Stripe key: optimistic grant ────────────────────────────────────────
  if (!process.env.STRIPE_SECRET_KEY) {
    console.warn('[verify] STRIPE_SECRET_KEY not set — optimistic grant');
    const expiry = computeExpiry(null);
    return res.json({
      ok:         true,
      active:     true,
      status:     'active',
      expires_at: expiry.toISOString(),
      email:      queryEmail || null,
      note:       'unverified — Stripe not configured',
    });
  }

  try {
    const stripe = getStripe();

    // ── Check idempotency — already processed? ──────────────────────────────
    if (!useMemory()) {
      const { rows: existing } = await query(
        `SELECT s.expires_at, s.status, u.email
         FROM processed_sessions ps
         JOIN subscriptions s ON s.stripe_session_id = ps.stripe_session_id
         JOIN users u ON u.id = s.user_id
         WHERE ps.stripe_session_id = $1`,
        [session_id]
      );
      if (existing.length) {
        console.log('[verify] already processed:', session_id);
        return res.json({
          ok:         true,
          active:     existing[0].status === 'active' || existing[0].status === 'trialing',
          status:     existing[0].status,
          expires_at: existing[0].expires_at,
          email:      existing[0].email,
          idempotent: true,
        });
      }
    }

    // ── Retrieve Stripe session ─────────────────────────────────────────────
    let session;
    try {
      session = await stripe.checkout.sessions.retrieve(session_id, {
        expand: ['subscription'],
      });
    } catch {
      session = await stripe.checkout.sessions.retrieve(session_id);
    }

    const paymentStatus = session.payment_status;
    const sub           = session.subscription;
    const subStatus     = sub?.status || null;

    const active =
      paymentStatus === 'paid' ||
      paymentStatus === 'no_payment_required' ||
      subStatus === 'active' ||
      subStatus === 'trialing';

    const email          = session.customer_details?.email || queryEmail || null;
    const stripeSubId    = sub?.id   || null;
    const stripeCustomer = sub?.customer || session.customer || null;
    const dbStatus       = subStatus || (active ? 'trialing' : 'unpaid');

    // Compute expiry from Stripe subscription period if available
    let expiresAt;
    if (sub?.current_period_end) {
      expiresAt = new Date(sub.current_period_end * 1000);
    } else {
      expiresAt = computeExpiry(null); // fallback: now + 30 days
    }

    // ── Write to DB ─────────────────────────────────────────────────────────
    if (email && active) {
      if (useMemory()) {
        // In-memory path
        let user = memDB.users.find(u => u.email === email);
        if (!user) {
          user = { id: Date.now(), email, status: dbStatus,
                   stripe_customer_id: stripeCustomer,
                   created_at: new Date().toISOString(),
                   last_seen:  new Date().toISOString() };
          memDB.users.push(user);
        } else {
          user.status = dbStatus;
          user.stripe_customer_id = stripeCustomer;
        }

        let sub_row = memDB.subscriptions.find(s => s.stripe_session_id === session_id);
        if (!sub_row) {
          memDB.subscriptions.push({
            id: Date.now(), user_id: user.id,
            stripe_session_id: session_id,
            stripe_sub_id: stripeSubId,
            stripe_customer_id: stripeCustomer,
            status: dbStatus, plan: 'monthly',
            expires_at: expiresAt.toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }
      } else {
        // PostgreSQL path
        // 1. Upsert user — set status + stripe_customer_id
        const { rows: userRows } = await query(
          `INSERT INTO users (email, status, stripe_customer_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (email) DO UPDATE SET
             status             = EXCLUDED.status,
             stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, users.stripe_customer_id),
             last_seen          = NOW()
           RETURNING id`,
          [email, dbStatus, stripeCustomer]
        );
        const userId = userRows[0].id;

        // 2. Upsert subscription with correct expiry
        //    ON CONFLICT: only update if not already processed (idempotency)
        await query(
          `INSERT INTO subscriptions
             (user_id, stripe_session_id, stripe_sub_id, stripe_customer_id, status, plan, expires_at)
           VALUES ($1, $2, $3, $4, $5, 'monthly', $6)
           ON CONFLICT (stripe_session_id) DO UPDATE SET
             status             = EXCLUDED.status,
             stripe_sub_id      = COALESCE(EXCLUDED.stripe_sub_id, subscriptions.stripe_sub_id),
             stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, subscriptions.stripe_customer_id),
             expires_at         = EXCLUDED.expires_at,
             updated_at         = NOW()`,
          [userId, session_id, stripeSubId, stripeCustomer, dbStatus, expiresAt]
        );

        // 3. Mark session as processed (idempotency guard)
        await query(
          `INSERT INTO processed_sessions (stripe_session_id) VALUES ($1)
           ON CONFLICT DO NOTHING`,
          [session_id]
        );

        // 4. Also write to email_leads (idempotent)
        await query(
          `INSERT INTO email_leads (email, source) VALUES ($1, 'stripe_checkout')
           ON CONFLICT (email) DO NOTHING`,
          [email]
        );

        console.log(`[verify] ✅ ${email} → ${dbStatus} expires ${expiresAt.toISOString()}`);
      }
    }

    res.json({
      ok:         true,
      active,
      status:     dbStatus,
      expires_at: expiresAt.toISOString(),
      email,
    });

  } catch (err) {
    console.error('[verify] error:', err.message);
    // Still grant premium — localStorage is already set
    // DB write can be retried via webhook
    res.json({
      ok:         true,
      active:     true,
      status:     'active',
      expires_at: computeExpiry(null).toISOString(),
      email:      queryEmail || null,
      note:       'verify error — optimistic grant',
    });
  }
});

// ─── GET /api/subscriptions/status?email=xxx ──────────────────────────────────
//
// Called every 5 min from app load to sync UI with backend truth.
// Returns real expiry from DB, not just Stripe.
//
router.get('/status', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'email required' });

  try {
    if (useMemory()) {
      const user = memDB.users.find(u => u.email === email);
      const sub  = memDB.subscriptions
        .filter(s => s.user_id === user?.id)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

      const now    = new Date();
      const expiry = sub?.expires_at ? new Date(sub.expires_at) : null;
      const active = expiry ? expiry > now : false;

      return res.json({
        ok:         true,
        active,
        status:     active ? 'active' : 'expired',
        expires_at: expiry?.toISOString() || null,
        email,
      });
    }

    // Get the latest subscription for this user
    const { rows } = await query(
      `SELECT s.status, s.expires_at, s.stripe_sub_id
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id
       WHERE u.email = $1
         AND s.status IN ('active', 'trialing')
       ORDER BY s.expires_at DESC NULLS LAST
       LIMIT 1`,
      [email]
    );

    if (!rows.length) {
      return res.json({ ok: true, active: false, status: 'none', expires_at: null, email });
    }

    const sub    = rows[0];
    const now    = new Date();
    const expiry = sub.expires_at ? new Date(sub.expires_at) : null;
    const active = expiry ? expiry > now : sub.status === 'trialing';

    // If expired in DB but status still says active — fix it
    if (!active && sub.status === 'active' && expiry) {
      await query(
        `UPDATE subscriptions SET status = 'expired', updated_at = NOW()
         WHERE stripe_sub_id = $1`,
        [sub.stripe_sub_id]
      ).catch(() => {});
      await query(
        `UPDATE users SET status = 'free' WHERE email = $1`,
        [email]
      ).catch(() => {});
    }

    res.json({
      ok:         true,
      active,
      status:     active ? sub.status : 'expired',
      expires_at: expiry?.toISOString() || null,
      email,
    });

  } catch (err) {
    console.error('[status]', err.message);
    res.status(500).json({ error: 'Failed to fetch subscription status' });
  }
});

// ─── POST /api/subscriptions/webhook ──────────────────────────────────────────
//
// Handles Stripe events — the true source of truth for subscription state.
// Set webhook URL in Stripe dashboard:
//   https://phonics-api-k43i.onrender.com/api/subscriptions/webhook
//
// Events to subscribe:
//   checkout.session.completed   → grant access + set expiry
//   invoice.paid                 → renew (extend expiry)
//   invoice.payment_failed       → mark dunning/past_due
//   customer.subscription.deleted → cancel + expire
//
router.post('/webhook', async (req, res) => {
  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    console.warn('[webhook] STRIPE_WEBHOOK_SECRET not set — skipping verification');
    return res.json({ received: true });
  }

  let event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error('[webhook] signature failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  console.log(`[webhook] ${event.type}`);

  try {
    await handleWebhookEvent(event);
  } catch (err) {
    // Always return 200 to Stripe — re-process is handled by Stripe retry
    console.error('[webhook] handler error (non-fatal):', err.message);
  }

  res.json({ received: true });
});

async function handleWebhookEvent(event) {
  const stripe = getStripe();

  switch (event.type) {

    // ── Checkout completed: initial purchase or trial start ────────────────
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (session.mode !== 'subscription') break;

      const email    = session.customer_details?.email || null;
      const subId    = session.subscription;
      const customer = session.customer;
      if (!email) break;

      // Fetch subscription to get period end
      const sub = await stripe.subscriptions.retrieve(subId);
      const expiresAt = new Date(sub.current_period_end * 1000);
      const dbStatus  = sub.status; // 'trialing' or 'active'

      await upsertSubscription({
        email, stripeSubId: subId, stripeCustomer: customer,
        sessionId: session.id, status: dbStatus, expiresAt,
      });
      break;
    }

    // ── Invoice paid: monthly renewal ─────────────────────────────────────
    case 'invoice.paid': {
      const invoice = event.data.object;
      if (invoice.billing_reason === 'subscription_create') break; // handled by checkout.session.completed
      const subId    = invoice.subscription;
      const customer = invoice.customer;
      if (!subId) break;

      const sub       = await stripe.subscriptions.retrieve(subId);
      const email     = sub.customer_details?.email ||
                        (await stripe.customers.retrieve(customer))?.email || null;
      if (!email) break;

      // Renewal: extend from max(current_expiry, now) + 30 days
      const currentExpiry = await getCurrentExpiry(email);
      const expiresAt     = computeExpiry(currentExpiry);

      await upsertSubscription({
        email, stripeSubId: subId, stripeCustomer: customer,
        sessionId: null, status: 'active', expiresAt,
      });

      console.log(`[webhook] invoice.paid renewal: ${email} → expires ${expiresAt.toISOString()}`);
      break;
    }

    // ── Payment failed: dunning — grace period, don't revoke yet ──────────
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const subId   = invoice.subscription;
      if (!subId) break;

      if (!useMemory()) {
        await query(
          `UPDATE subscriptions SET status = 'past_due', updated_at = NOW()
           WHERE stripe_sub_id = $1`,
          [subId]
        );
      }
      console.log(`[webhook] payment_failed for sub: ${subId}`);
      break;
    }

    // ── Subscription cancelled: revoke access ─────────────────────────────
    case 'customer.subscription.deleted': {
      const sub     = event.data.object;
      const subId   = sub.id;
      const endedAt = sub.ended_at ? new Date(sub.ended_at * 1000) : new Date();

      if (!useMemory()) {
        // Set expiry to now (or when it actually ended) + update status
        await query(
          `UPDATE subscriptions
           SET status = 'cancelled', expires_at = $1, updated_at = NOW()
           WHERE stripe_sub_id = $2`,
          [endedAt, subId]
        );
        // Update user status back to free
        await query(
          `UPDATE users u SET status = 'free'
           FROM subscriptions s
           WHERE s.user_id = u.id AND s.stripe_sub_id = $1`,
          [subId]
        );
      }
      console.log(`[webhook] subscription.deleted: ${subId}`);
      break;
    }
  }
}

// ─── Shared upsert helper used by verify + webhook ────────────────────────────
async function upsertSubscription({ email, stripeSubId, stripeCustomer, sessionId, status, expiresAt }) {
  if (useMemory()) {
    let user = memDB.users.find(u => u.email === email);
    if (!user) {
      user = { id: Date.now(), email, status, stripe_customer_id: stripeCustomer,
               created_at: new Date().toISOString(), last_seen: new Date().toISOString() };
      memDB.users.push(user);
    } else {
      user.status = status;
      user.stripe_customer_id = stripeCustomer;
    }
    const existing = memDB.subscriptions.find(s => s.stripe_sub_id === stripeSubId);
    if (existing) {
      existing.status     = status;
      existing.expires_at = expiresAt.toISOString();
      existing.updated_at = new Date().toISOString();
    } else {
      memDB.subscriptions.push({
        id: Date.now(), user_id: user.id,
        stripe_session_id: sessionId, stripe_sub_id: stripeSubId,
        stripe_customer_id: stripeCustomer,
        status, plan: 'monthly',
        expires_at: expiresAt.toISOString(),
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
    }
    return;
  }

  // Upsert user
  const { rows: userRows } = await query(
    `INSERT INTO users (email, status, stripe_customer_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET
       status             = EXCLUDED.status,
       stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, users.stripe_customer_id),
       last_seen          = NOW()
     RETURNING id`,
    [email, status, stripeCustomer]
  );
  const userId = userRows[0].id;

  // Upsert subscription
  if (sessionId) {
    await query(
      `INSERT INTO subscriptions
         (user_id, stripe_session_id, stripe_sub_id, stripe_customer_id, status, plan, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'monthly', $6)
       ON CONFLICT (stripe_session_id) DO UPDATE SET
         status             = EXCLUDED.status,
         stripe_sub_id      = COALESCE(EXCLUDED.stripe_sub_id, subscriptions.stripe_sub_id),
         stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, subscriptions.stripe_customer_id),
         expires_at         = EXCLUDED.expires_at,
         updated_at         = NOW()`,
      [userId, sessionId, stripeSubId, stripeCustomer, status, expiresAt]
    );
    await query(
      `INSERT INTO processed_sessions (stripe_session_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [sessionId]
    );
  } else {
    // Renewal via invoice — update by stripe_sub_id
    await query(
      `INSERT INTO subscriptions
         (user_id, stripe_sub_id, stripe_customer_id, status, plan, expires_at)
       VALUES ($1, $2, $3, $4, 'monthly', $5)
       ON CONFLICT (stripe_sub_id) DO UPDATE SET
         status             = EXCLUDED.status,
         expires_at         = EXCLUDED.expires_at,
         stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, subscriptions.stripe_customer_id),
         updated_at         = NOW()`,
      [userId, stripeSubId, stripeCustomer, status, expiresAt]
    );
  }

  await query(
    `INSERT INTO email_leads (email, source) VALUES ($1, 'stripe') ON CONFLICT (email) DO NOTHING`,
    [email]
  );
}

async function getCurrentExpiry(email) {
  if (useMemory()) {
    const user = memDB.users.find(u => u.email === email);
    const sub  = memDB.subscriptions
      .filter(s => s.user_id === user?.id)
      .sort((a, b) => new Date(b.expires_at) - new Date(a.expires_at))[0];
    return sub?.expires_at || null;
  }
  const { rows } = await query(
    `SELECT s.expires_at FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     WHERE u.email = $1 ORDER BY s.expires_at DESC NULLS LAST LIMIT 1`,
    [email]
  );
  return rows[0]?.expires_at || null;
}

module.exports = router;