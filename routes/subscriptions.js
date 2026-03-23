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
// GET /api/subscriptions/verify with enhanced logging
router.get('/verify', async (req, res) => {
  const { session_id, queryEmail } = req.query;
  
  console.log('=== VERIFY ENDPOINT CALLED ===');
  console.log('Session ID:', session_id);
  console.log('Query Email:', queryEmail);
  console.log('Database Mode:', useMemory() ? 'MEMORY' : 'POSTGRES');
  
  if (!session_id) {
    return res.status(400).json({ error: 'session_id required' });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;

  if (!stripeKey) {
    console.warn('[subscriptions.verify] STRIPE_SECRET_KEY not set — granting optimistically');
    return res.json({
      ok: true,
      active: true,
      status: 'active',
      customer: queryEmail ? { email: queryEmail } : null,
      note: 'unverified — Stripe not configured',
    });
  }

  try {
    const stripe = require('stripe')(stripeKey);
    
    console.log('Retrieving Stripe session...');
    let session;
    try {
      session = await stripe.checkout.sessions.retrieve(session_id, {
        expand: ['subscription', 'customer'],
      });
      console.log('Stripe session retrieved successfully');
      console.log('Session payment_status:', session.payment_status);
      console.log('Session subscription status:', session.subscription?.status);
      console.log('Session customer email:', session.customer_details?.email || session.customer?.email);
    } catch (expandErr) {
      console.warn('Expand failed, retrying plain:', expandErr.message);
      session = await stripe.checkout.sessions.retrieve(session_id);
      console.log('Plain session retrieved');
    }

    // Determine active state
    const paymentStatus = session.payment_status;
    const subStatus = session.subscription?.status || null;
    const active = paymentStatus === 'paid' ||
                   paymentStatus === 'no_payment_required' ||
                   subStatus === 'active' ||
                   subStatus === 'trialing';

    const email = session.customer_details?.email || 
                  session.customer?.email || 
                  queryEmail || 
                  null;
    
    const stripeSubId = session.subscription?.id || null;
    const stripeCustomerId = session.customer?.id || null;
    const dbStatus = subStatus || (active ? 'trialing' : 'unpaid');

    console.log('Processed data:', {
      email,
      active,
      dbStatus,
      stripeSubId,
      stripeCustomerId
    });

    // ── Write to DB ──
    let userId = null;
    let subscriptionCreated = false;

    if (email) {
      try {
        console.log('Attempting database write for email:', email);
        
        // Test database connection first
        if (!useMemory()) {
          try {
            const testResult = await query('SELECT NOW() as current_time');
            console.log('Database connection test successful:', testResult.rows[0]);
          } catch (connErr) {
            console.error('Database connection test FAILED:', connErr.message);
            throw new Error(`Database connection failed: ${connErr.message}`);
          }
        }
        
        if (useMemory()) {
          // Memory DB logic
          const { memDB } = require('../db/init');
          console.log('Using memory DB, current users:', memDB.users?.length || 0);
          
          let user = memDB.users.find(u => u.email === email);
          if (user) {
            if (active) user.status = dbStatus;
            userId = user.id;
            console.log('Updated existing user in memory:', userId);
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
            console.log('Created new user in memory:', userId);
          }
          
          // Add subscription in memory
          memDB.subscriptions = memDB.subscriptions || [];
          const subscription = {
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
          memDB.subscriptions.push(subscription);
          subscriptionCreated = true;
          console.log('Created subscription in memory:', subscription);
          
        } else {
          // PostgreSQL - with detailed error logging
          console.log('Attempting PostgreSQL operations...');
          
          // Step 1: Upsert user
          const userQuery = `
            INSERT INTO users (email, status, created_at, last_seen)
            VALUES ($1, $2, NOW(), NOW())
            ON CONFLICT (email) DO UPDATE SET
              last_seen = NOW(),
              status = CASE 
                WHEN $2 IN ('active', 'trialing') THEN $2 
                ELSE users.status 
              END
            RETURNING id, email, status
          `;
          
          console.log('Executing user upsert with:', { email, status: dbStatus });
          const userResult = await query(userQuery, [email, dbStatus]);
          console.log('User upsert result:', JSON.stringify(userResult.rows));
          
          if (!userResult.rows || userResult.rows.length === 0) {
            throw new Error('User upsert returned no rows');
          }
          
          userId = userResult.rows[0].id;
          console.log('User ID obtained:', userId);
          
          // Step 2: Insert subscription if active
          if (active) {
            const subQuery = `
              INSERT INTO subscriptions (
                user_id, stripe_session_id, stripe_sub_id, 
                stripe_customer_id, status, plan, created_at, updated_at
              )
              VALUES ($1, $2, $3, $4, $5, 'monthly', NOW(), NOW())
              ON CONFLICT (stripe_session_id) DO UPDATE SET
                status = EXCLUDED.status,
                stripe_sub_id = COALESCE(EXCLUDED.stripe_sub_id, subscriptions.stripe_sub_id),
                stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, subscriptions.stripe_customer_id),
                updated_at = NOW()
              RETURNING id, user_id, stripe_session_id, status
            `;
            
            console.log('Executing subscription insert with:', {
              userId,
              session_id,
              stripeSubId,
              stripeCustomerId,
              status: dbStatus
            });
            
            const subResult = await query(subQuery, [
              userId, session_id, stripeSubId, stripeCustomerId, dbStatus
            ]);
            
            console.log('Subscription insert result:', JSON.stringify(subResult.rows));
            subscriptionCreated = true;
          }
        }
        
        console.log(`✅ Database write successful: user=${userId}, subscription_created=${subscriptionCreated}`);
        
      } catch (dbErr) {
        console.error('❌ DATABASE ERROR DETAILS:', {
          message: dbErr.message,
          code: dbErr.code,
          detail: dbErr.detail,
          hint: dbErr.hint,
          stack: dbErr.stack,
          table: dbErr.table,
          constraint: dbErr.constraint
        });
        // Don't rethrow - continue to return success to client
      }
    } else {
      console.log('No email found, skipping database write');
    }

    // Return response
    res.json({
      ok: true,
      active,
      status: dbStatus,
      email: email || null,
      userId: userId,
      subscriptionCreated: subscriptionCreated,
      stripeSubscriptionId: stripeSubId,
      debug: process.env.NODE_ENV === 'development' ? {
        session_id,
        paymentStatus,
        subStatus,
        dbStatus,
        stripeCustomerId
      } : undefined,
      timestamp: new Date().toISOString()
    });
    
  } catch (err) {
    console.error('❌ FATAL ERROR in verify endpoint:', err.message, err.stack);
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