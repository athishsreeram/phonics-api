# Phonics Hub — Split Architecture Setup Guide

## Overview

Three separate projects, each deployed independently:

```
phonics-api/      → Node.js + Express + PostgreSQL  →  Render / Railway
phonics-app/      → Static HTML/JS                  →  Vercel (phonics77-app.vercel.app)
phonics-admin/    → Static HTML/JS                  →  Vercel (phonics-admin.vercel.app)
```

Data flow:
```
User plays phonics-app
       ↓  HTTP POST (fire-and-forget)
  phonics-api  ←→  PostgreSQL (Neon)
       ↑  JWT-protected GET
Admin views phonics-admin
```

---

## STEP 1 — Set up PostgreSQL (Neon — free tier)

1. Go to https://neon.tech and create a free account
2. Create a new project → name it `phonics-hub`
3. Copy the **Connection string** — looks like:
   ```
   postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
4. Save this — you'll need it in Step 2

---

## STEP 2 — Deploy the API (Render — free tier)

### 2a. Push phonics-api to GitHub

```bash
cd phonics-api
git init
git add .
git commit -m "initial"
gh repo create phonics-api --private --push
# or: git remote add origin https://github.com/YOUR_USER/phonics-api && git push -u origin main
```

### 2b. Deploy on Render

1. Go to https://render.com → New → Web Service
2. Connect your `phonics-api` GitHub repo
3. Settings:
   - **Build command:** `npm install`
   - **Start command:** `node server.js`
   - **Environment:** Node
   - **Plan:** Free (or Starter $7/mo for always-on)

### 2c. Add environment variables in Render dashboard

Go to your service → Environment → Add these:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | your Neon connection string from Step 1 |
| `JWT_SECRET` | any long random string (e.g. run `openssl rand -hex 32`) |
| `ADMIN_EMAIL` | startdreamhere123@gmail.com |
| `ADMIN_PASSWORD` | choose a strong password |
| `STRIPE_SECRET_KEY` | sk_live_... from Stripe Dashboard |
| `STRIPE_PRICE_ID` | price_... from Stripe Dashboard |
| `STRIPE_WEBHOOK_SECRET` | whsec_... (set up in Step 3) |
| `ALLOWED_ORIGINS` | https://phonics77-app.vercel.app,https://phonics-admin.vercel.app |
| `NODE_ENV` | production |

### 2d. Run database migration

After deploy, open Render Shell (or run locally with the DATABASE_URL set):

```bash
# In Render Shell or locally:
node migrate.js
```

You should see: `✅ All tables created successfully`

### 2e. Note your API URL

After deploy, Render gives you a URL like:
```
https://phonics-api.onrender.com
```
Save this — you'll need it in Steps 4 and 5.

---

## STEP 3 — Set up Stripe Webhook

1. Go to https://dashboard.stripe.com/webhooks → Add endpoint
2. **Endpoint URL:** `https://phonics-api.onrender.com/api/subscriptions/webhook`
3. **Events to listen for:**
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Copy the **Signing secret** (starts with `whsec_`)
5. Add it as `STRIPE_WEBHOOK_SECRET` in Render environment variables
6. Redeploy (Render → Manual Deploy)

---

## STEP 4 — Update API URL in both front-end apps

### phonics-app/js/config.js
```js
window.PHONICS_API_BASE = 'https://phonics-api.onrender.com'; // ← your Render URL
```

### phonics-admin/js/config.js
```js
window.PHONICS_API_BASE = 'https://phonics-api.onrender.com'; // ← same
```

---

## STEP 5 — Deploy phonics-app to Vercel

```bash
cd phonics-app
npx vercel --prod
# When prompted:
#   Project name: phonics77-app (or your existing project name)
#   Output directory: .  (just press Enter)
```

Or push to GitHub and Vercel will auto-deploy.

**Verify:** open https://phonics77-app.vercel.app and play an activity.
Check Render logs — you should see the event arrive:
```
POST /api/events 200
```

---

## STEP 6 — Deploy phonics-admin to Vercel

```bash
cd phonics-admin
npx vercel --prod
# Project name: phonics-admin (new project)
# Output directory: .
```

**After deploy:**
1. Open https://phonics-admin.vercel.app
2. Log in with the ADMIN_EMAIL and ADMIN_PASSWORD you set in Render
3. You should see your dashboard with live data

---

## Local Development

### Run API locally

```bash
cd phonics-api
cp .env.example .env
# Edit .env with your DATABASE_URL and other values
npm install
node migrate.js          # first time only
npm run dev              # starts on http://localhost:3001
```

### Run phonics-app locally

```bash
cd phonics-app
# Edit js/config.js to point to localhost:
#   window.PHONICS_API_BASE = 'http://localhost:3001';
npx serve . -p 3000
# Open http://localhost:3000
```

### Run admin locally

```bash
cd phonics-admin
# Edit js/config.js to point to localhost:
#   window.PHONICS_API_BASE = 'http://localhost:3001';
npx serve . -p 4000
# Open http://localhost:4000
```

---

## Testing the full flow

```bash
# 1. Confirm API is running
curl https://phonics-api.onrender.com/health
# → {"ok":true,"ts":"...","env":"production"}

# 2. Send a test event
curl -X POST https://phonics-api.onrender.com/api/events \
  -H "Content-Type: application/json" \
  -d '{"type":"page_view","session":"test123","url":"/index.html","ua":"desktop","premium":false,"ts":1234567890}'
# → {"ok":true}

# 3. Log into admin dashboard
# POST https://phonics-api.onrender.com/api/admin/login
# body: {"email":"your@email.com","password":"yourpassword"}
# → {"token":"eyJ..."}

# 4. Check overview (replace TOKEN)
curl -H "Authorization: Bearer TOKEN" \
  https://phonics-api.onrender.com/api/admin/overview
# → full JSON with users, events, subscriptions
```

---

## Architecture diagram

```
┌─────────────────────┐     ┌──────────────────────────────────────┐
│   phonics-app        │     │           phonics-api                │
│   (Vercel)           │     │           (Render)                   │
│                      │     │                                      │
│  js/analytics.js ────┼────►│  POST /api/events    → events table  │
│  js/payment.js   ────┼────►│  POST /api/emails    → email_leads   │
│  pages/success.html ─┼────►│  GET  /api/subscriptions/verify      │
│  js/config.js        │     │  POST /api/subscriptions/checkout    │
│  (API_BASE URL) ─────┘     │  POST /api/subscriptions/webhook     │
└─────────────────────┘      │         ↕                            │
                              │     PostgreSQL (Neon)                │
┌─────────────────────┐      │   users, events, activity_progress   │
│   phonics-admin      │      │   email_leads, subscriptions, streaks│
│   (Vercel)           │      └──────────────────────────────────────┘
│                      │               ▲
│  index.html ─────────┼── JWT ────────┘
│  js/config.js        │  GET /api/admin/overview
│  (API_BASE URL)      │  GET /api/admin/users
└─────────────────────┘  GET /api/admin/events
                          GET /api/admin/emails
                          GET /api/admin/timeseries
```

---

## API Endpoints Reference

### Public (called by phonics-app — no auth)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/events` | Log a behavior event |
| POST | `/api/emails` | Capture email lead |
| POST | `/api/subscriptions/checkout` | Create Stripe checkout session |
| GET  | `/api/subscriptions/verify?session_id=cs_...` | Verify payment |
| POST | `/api/subscriptions/webhook` | Stripe webhook (raw body) |

### Admin (called by phonics-admin — JWT required)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/admin/login` | Get JWT token |
| GET  | `/api/admin/overview` | Full KPI summary |
| GET  | `/api/admin/users` | User list |
| GET  | `/api/admin/events` | Event log |
| GET  | `/api/admin/emails` | Email leads |
| GET  | `/api/admin/timeseries?days=30` | Time series data |

---

## Adding Mailchimp (optional)

In `phonics-api/routes/emails.js`, uncomment the Mailchimp block and add to Render env:

```
MAILCHIMP_API_KEY=abc123-us1
MAILCHIMP_LIST_ID=your_list_id
```

---

## Troubleshooting

**Events not arriving in database:**
- Check CORS: `ALLOWED_ORIGINS` must include your phonics app URL exactly
- Check `window.PHONICS_API_BASE` in `js/config.js` matches your Render URL
- Open browser DevTools → Network tab → look for POST to `/api/events`

**Admin login failing:**
- Confirm `ADMIN_EMAIL` and `ADMIN_PASSWORD` in Render env vars
- Check `JWT_SECRET` is set (any non-empty string)

**Stripe webhook failing:**
- Confirm webhook URL is `https://your-api.onrender.com/api/subscriptions/webhook`
- Confirm `STRIPE_WEBHOOK_SECRET` matches the signing secret in Stripe dashboard
- Note: Render free tier sleeps after 15min — use Starter ($7/mo) for reliable webhooks

**Render free tier cold starts:**
- Free tier sleeps after 15min of inactivity, taking ~30s to wake
- For production: upgrade to Starter ($7/mo) or use Railway ($5/mo)
- Alternative: use Vercel serverless functions (convert routes to /api/*.js)
