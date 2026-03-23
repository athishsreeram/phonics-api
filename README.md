# Phonics API

Production-ready backend for the Phonics Hub 3-app system.

```
phonics77-app (Vercel)     →  reads stories, logs events, handles payments
phonics-admin (GitHub Pages) →  manages stories, views analytics
phonics-api   (Render)      →  single source of truth  ← this repo
```

## Features

- ✅ **Stripe subscription** – 7‑day trial, checkout sessions, webhook verification
- ✅ **Neon PostgreSQL** – persistent storage with automatic in‑memory fallback
- ✅ **Admin authentication** – JWT‑protected story & analytics endpoints
- ✅ **Event logging** – track user progress for analytics dashboard
- ✅ **Email capture** – collect leads for marketing
- ✅ **CORS ready** – configure allowed frontend origins

---

## Quick Start (local)

```bash
cp .env.example .env
# Edit .env — add DATABASE_URL (Neon) or leave blank for in-memory mode

npm install
node src/db/migrate-standalone.js   # first time only, skip if no DB
npm run dev                          # starts on http://localhost:3001
```

Verify:

```bash
curl http://localhost:3001/health
# → {"ok":true,"ts":"...","env":"development"}
```

---

## Environment Variables

| Key | Required | Description |
|-----|----------|-------------|
| `DATABASE_URL` | Optional | Neon PostgreSQL connection string. Omit to use in-memory fallback. |
| `JWT_SECRET` | Yes | Long random string. `openssl rand -hex 32` |
| `ADMIN_EMAIL` | Yes | Login email for phonics-admin |
| `ADMIN_PASSWORD` | Yes | Login password for phonics-admin |
| `ALLOWED_ORIGINS` | Yes | Comma-separated frontend URLs (no trailing slash) |
| `STRIPE_SECRET_KEY` | For payments | Stripe secret key (starts with `sk_`) |
| `STRIPE_PRICE_ID` | For payments | Stripe subscription price ID |
| `STRIPE_WEBHOOK_SECRET` | For payments | Webhook signing secret (starts with `whsec_`) |
| `NODE_ENV` | No | `development` or `production` |

---

## API Reference

### Public endpoints (no auth)

| Method | Path | Used by | Description |
|--------|------|---------|-------------|
| GET | `/health` | Monitoring | Health check |
| GET | `/api/stories` | App 1 | List all stories |
| GET | `/api/stories/:id` | App 1 | Get single story |
| POST | `/api/events` | App 1 | Log analytics event |
| POST | `/api/emails` | App 1 | Capture email lead |
| POST | `/api/subscriptions/checkout` | App 1 | Create Stripe checkout session → returns URL |
| GET | `/api/subscriptions/verify` | App 1 | Verify payment & write to DB |

### Admin endpoints (JWT required)

| Method | Path | Used by | Description |
|--------|------|---------|-------------|
| POST | `/api/admin/login` | App 2 | Get JWT token |
| GET | `/api/admin/overview` | App 2 | KPIs (users, events, subscriptions) |
| GET | `/api/admin/users` | App 2 | User list with subscription status |
| GET | `/api/admin/events` | App 2 | Event log |
| GET | `/api/admin/emails` | App 2 | Email leads |
| GET | `/api/admin/timeseries?days=30` | App 2 | Chart data |
| POST | `/api/stories` | App 2 | Create story |
| PUT | `/api/stories/:id` | App 2 | Update story |
| DELETE | `/api/stories/:id` | App 2 | Delete story |

---

## Stripe Subscription Flow

1. **App calls** `POST /api/subscriptions/checkout` → returns Stripe Checkout URL
2. **User completes payment** on Stripe (7‑day trial)
3. **Redirect to success page** with `session_id` query param
4. **Success page calls** `GET /api/subscriptions/verify?session_id=...&email=...`
5. **API verifies** session, writes to `users` and `subscriptions` tables, returns `{ active: true }`
6. **App unlocks premium features**

### Database Tables Created

```sql
-- users: id, email, status (active/trialing/free), created_at, last_seen
-- subscriptions: id, user_id, stripe_session_id (unique), stripe_sub_id, 
--                stripe_customer_id, status, plan, created_at, updated_at, expires_at
-- email_leads: id, email, source, created_at
-- events: id, user_email, event_type, story_id, metadata, created_at
-- stories: id, title, content, order_index, is_active, created_at
```

---

## Testing the API

```bash
# Test live API
bash test/curl-tests.sh

# Test local
API=http://localhost:3001 bash test/curl-tests.sh

# With your real admin password
ADMIN_PASSWORD=yourpass bash test/curl-tests.sh

# Test Stripe verification (replace session_id)
curl -H 'Cache-Control: no-cache' \
  'http://localhost:3001/api/subscriptions/verify?session_id=cs_test_xxx&email=test@example.com'
```

---

## App Integration

### App 1 — phonics77-app

1. Copy `integration/app1/config.js` → `phonics77-app/js/config.js`
2. Copy `integration/app1/stories-loader.js` → `phonics77-app/js/stories-loader.js`
3. In `story.html`, replace hardcoded story content with:

```html
<div id="story-container"></div>
<script src="js/config.js"></script>
<script src="js/stories-loader.js"></script>
```

4. Link to specific story: `story.html?id=2`

### App 2 — phonics-admin

1. Copy `integration/app2/stories-admin.js` → `phonics-admin/js/stories-admin.js`
2. Add to admin `index.html`:

```html
<section id="stories-section">
  <h2>📖 Stories</h2>
  <button onclick="StoriesAdmin.showCreateForm()">+ New Story</button>
  <div id="stories-form" style="display:none"></div>
  <div id="stories-list"></div>
</section>
<script src="js/config.js"></script>
<script src="js/stories-admin.js"></script>
```

The script auto-loads stories on page load. JWT token must be in `localStorage` as `phonics_admin_token` (already handled by your existing login flow).

---

## Folder Structure

```
phonics-api/
├── src/
│   ├── server.js                 ← entry point
│   ├── db/
│   │   ├── init.js               ← pg + in-memory fallback
│   │   └── migrate-standalone.js ← run once to create tables
│   ├── routes/
│   │   ├── stories.js
│   │   ├── events.js
│   │   ├── emails.js
│   │   ├── admin.js
│   │   └── subscriptions.js      ← Stripe endpoints
│   ├── controllers/
│   │   └── stories.js
│   └── middleware/
│       └── auth.js
├── integration/
│   ├── app1/
│   │   ├── config.js
│   │   └── stories-loader.js
│   └── app2/
│       └── stories-admin.js
├── test/
│   ├── curl-tests.sh
│   └── sample-data.json
├── .env.example
├── package.json
└── README.md
```

---

## In-Memory Fallback

If `DATABASE_URL` is not set, the API uses an in-memory store seeded with 3 sample stories. All CRUD works — data is lost on server restart. Good for staging/testing.

---

## Deploying to Render

1. Push this repo to GitHub
2. Render → New Web Service → connect repo
3. Build command: `npm install`
4. Start command: `node src/server.js`
5. Add all env vars from `.env.example`
6. After first deploy: open Render Shell → `node src/db/migrate-standalone.js`

### Troubleshooting Database Writes

If subscriptions aren't saving to Neon:

1. Check Render logs for `[subscriptions.verify]` entries
2. Verify `DATABASE_URL` is set correctly
3. Run migration script to ensure tables exist
4. Use the `/api/subscriptions/debug-check?email=...` endpoint to inspect state

---

## License

MIT

---

This README reflects the current state of your API with full Stripe integration and Neon database support. Let me know if you'd like to add any specific sections or adjust anything!