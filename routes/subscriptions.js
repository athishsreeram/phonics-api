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
// Now with comprehensive error handling and database fixes.
router.get('/verify', async (req, res) => {
  const { session_id, queryEmail } = req.query;
  
  if (!session_id) {
    return res.status(400).json({ error: 'session_id required' });
  }

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

    // Retrieve session with expanded subscription
    let session;
    try {
      session = await stripe.checkout.sessions.retrieve(session_id, {
        expand: ['subscription', 'customer'],
      });
    } catch (expandErr) {
      console.warn('[subscriptions.verify] expand failed, retrying plain:', expandErr.message);
      session = await stripe.checkout.sessions.retrieve(session_id);
    }

    // Determine active state
    const paymentStatus = session.payment_status;
    const subStatus = session.subscription?.status || null;
    const active = paymentStatus === 'paid' ||
                   paymentStatus === 'no_payment_required' ||
                   subStatus === 'active' ||
                   subStatus === 'trialing';

    // Get email from multiple sources
    const email = session.customer_details?.email || 
                  session.customer?.email || 
                  queryEmail || 
                  null;
    
    const stripeSubId = session.subscription?.id || null;
    const stripeCustomerId = session.customer?.id || session.customer_details?.id || null;
    const dbStatus = subStatus || (active ? 'trialing' : 'unpaid');

    console.log('[subscriptions.verify] Stripe session data:', {
      session_id,
      email,
      active,
      dbStatus,
      stripeSubId,
      stripeCustomerId,
      paymentStatus,
      subStatus
    });

    // ── Write to DB with comprehensive error handling ──
    let userId = null;
    let subscriptionRecord = null;

    if (email) {
      try {
        console.log('[subscriptions.verify] Attempting to write to DB for email:', email);
        
        if (useMemory()) {
          // Memory DB logic (fallback for development)
          const { memDB } = require('../db/init');
          let user = memDB.users.find(u => u.email === email);
          
          if (user) {
            if (active) user.status = dbStatus;
            userId = user.id;
            console.log('[subscriptions.verify] Updated existing user in memory:', { userId, email });
          } else {
            userId = Date.now();
            user = { 
              id: userId, 
              email, 
              status: active ? dbStatus : 'free',
              created_at: new Date().toISOString(), 
              last_seen: new Date().toISOString() 
            };
            memDB.users.push(user);
            console.log('[subscriptions.verify] Created new user in memory:', { userId, email });
          }
          
          // Add to email_leads if not exists
          if (!memDB.emails.find(e => e.email === email)) {
            memDB.emails.push({ 
              id: Date.now() + 1, 
              email, 
              name: null,
              source: 'stripe_checkout', 
              created_at: new Date().toISOString() 
            });
          }
          
          // Add subscription in memory
          subscriptionRecord = {
            id: Date.now() + 2,
            user_id: userId,
            stripe_session_id: session_id,
            stripe_sub_id: stripeSubId,
            stripe_customer_id: stripeCustomerId,
            status: dbStatus,
            plan: 'monthly',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          memDB.subscriptions = memDB.subscriptions || [];
          memDB.subscriptions.push(subscriptionRecord);
          
        } else {
          // ── PostgreSQL (Neon) with proper error handling ──
          
          // Step 1: Ensure user exists and get/update their record
          const userResult = await query(
            `INSERT INTO users (email, status, created_at, last_seen)
             VALUES ($1, $2, NOW(), NOW())
             ON CONFLICT (email) DO UPDATE SET
               last_seen = NOW(),
               status = CASE 
                 WHEN $2 IN ('active', 'trialing') THEN $2 
                 ELSE users.status 
               END
             RETURNING id, email, status, created_at`,
            [email, dbStatus]
          );
          
          if (!userResult.rows || userResult.rows.length === 0) {
            throw new Error(`Failed to create/update user for email: ${email}`);
          }
          
          userId = userResult.rows[0].id;
          console.log('[subscriptions.verify] User operation successful:', { 
            userId, 
            email, 
            status: userResult.rows[0].status 
          });

          // Step 2: Add to email_leads (idempotent, don't block if fails)
          try {
            await query(
              `INSERT INTO email_leads (email, source, created_at)
               VALUES ($1, 'stripe_checkout', NOW())
               ON CONFLICT (email) DO UPDATE SET
                 source = EXCLUDED.source,
                 updated_at = NOW()`,
              [email]
            );
            console.log('[subscriptions.verify] Email lead added/updated for:', email);
          } catch (leadErr) {
            console.warn('[subscriptions.verify] Email lead insert failed (non-critical):', leadErr.message);
          }

          // Step 3: Insert or update subscription
          if (active) {
            const subscriptionResult = await query(
              `INSERT INTO subscriptions (
                user_id, 
                stripe_session_id, 
                stripe_sub_id, 
                stripe_customer_id, 
                status, 
                plan, 
                created_at, 
                updated_at,
                expires_at
              )
              VALUES ($1, $2, $3, $4, $5, 'monthly', NOW(), NOW(), 
                CASE 
                  WHEN $5 = 'active' THEN NOW() + INTERVAL '30 days'
                  WHEN $5 = 'trialing' THEN NOW() + INTERVAL '7 days'
                  ELSE NULL
                END
              )
              ON CONFLICT (stripe_session_id) DO UPDATE SET
                status = EXCLUDED.status,
                stripe_sub_id = COALESCE(EXCLUDED.stripe_sub_id, subscriptions.stripe_sub_id),
                stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, subscriptions.stripe_customer_id),
                updated_at = NOW(),
                expires_at = CASE 
                  WHEN EXCLUDED.status IN ('active', 'trialing') 
                  THEN NOW() + INTERVAL '30 days'
                  ELSE subscriptions.expires_at
                END
              RETURNING id, user_id, stripe_session_id, status, stripe_sub_id`,
              [userId, session_id, stripeSubId, stripeCustomerId, dbStatus]
            );
            
            subscriptionRecord = subscriptionResult.rows[0];
            console.log('[subscriptions.verify] Subscription operation successful:', subscriptionRecord);
          } else {
            console.log('[subscriptions.verify] Subscription not active, skipping insert:', { userId, active, dbStatus });
          }
        }

        console.log(`[subscriptions.verify] ✅ Database write complete for ${email} → ${dbStatus} | session: ${session_id}`);
        
      } catch (dbErr) {
        // Log detailed error but don't throw - we still want to return success to client
        console.error('[subscriptions.verify] ❌ Database write failed (non-fatal):', {
          message: dbErr.message,
          stack: dbErr.stack,
          code: dbErr.code,
          detail: dbErr.detail,
          table: dbErr.table,
          constraint: dbErr.constraint
        });
        
        // Check for specific errors
        if (dbErr.code === '23503') { // Foreign key violation
          console.error('[subscriptions.verify] Foreign key violation - user might not exist properly');
        } else if (dbErr.code === '42P01') { // Table doesn't exist
          console.error('[subscriptions.verify] Table doesn\'t exist - check your database schema');
        } else if (dbErr.code === '23505') { // Unique violation
          console.error('[subscriptions.verify] Unique violation - duplicate key');
        }
      }
    } else {
      console.log('[subscriptions.verify] No email found in session or query, skipping DB write');
    }

    // ── Return response with subscription status ──
    res.json({
      ok: true,
      active,
      status: dbStatus,
      email: email || null,
      userId: userId,
      subscriptionId: subscriptionRecord?.id || null,
      stripeSubscriptionId: stripeSubId,
      customer: session.customer_details || (email ? { email } : null),
      timestamp: new Date().toISOString()
    });
    
  } catch (err) {
    // Never return 500 - always grant optimistically so premium unlocks
    console.error('[subscriptions.verify] ❌ Fatal error:', {
      message: err.message,
      stack: err.stack,
      session_id
    });
    
    // Return optimistic grant so frontend can still unlock premium
    res.json({
      ok: true,
      active: true,
      status: 'active',
      email: queryEmail || null,
      note: 'verify error — optimistic grant',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
      timestamp: new Date().toISOString()
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