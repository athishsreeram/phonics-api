# phonics-api-fixed

Production-ready backend for the Phonics Hub 3-app system.

```
phonics77-app (Vercel)     →  reads stories, logs events
phonics-admin (GitHub Pages) →  manages stories, views analytics
phonics-api   (Render)      →  single source of truth  ← this repo
```

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
| `ADMIN_EMAIL` | Yes | Login email for App 2 (phonics-admin) |
| `ADMIN_PASSWORD` | Yes | Login password for App 2 |
| `ALLOWED_ORIGINS` | Yes | Comma-separated frontend URLs (no trailing slash) |
| `STRIPE_SECRET_KEY` | No | Stripe payments |
| `STRIPE_PRICE_ID` | No | Stripe subscription price |
| `STRIPE_WEBHOOK_SECRET` | No | Stripe webhook signing secret |

**Render deploy:** paste all env vars in Render → Your Service → Environment.

---

## API Reference

### Public endpoints (no auth)

| Method | Path | Used by |
|--------|------|---------|
| GET | `/health` | monitoring |
| GET | `/api/stories` | App 1 — load story list |
| GET | `/api/stories/:id` | App 1 — load single story |
| POST | `/api/events` | App 1 — log analytics event |
| POST | `/api/emails` | App 1 — capture email lead |
| POST | `/api/subscriptions/checkout` | App 1 — Stripe checkout |
| GET | `/api/subscriptions/verify` | App 1 — verify payment |

### Admin endpoints (JWT required)

| Method | Path | Used by |
|--------|------|---------|
| POST | `/api/admin/login` | App 2 — get token |
| GET | `/api/admin/overview` | App 2 — KPIs |
| GET | `/api/admin/users` | App 2 — user list |
| GET | `/api/admin/events` | App 2 — event log |
| GET | `/api/admin/emails` | App 2 — leads |
| GET | `/api/admin/timeseries?days=30` | App 2 — chart data |
| POST | `/api/stories` | App 2 — create story |
| PUT | `/api/stories/:id` | App 2 — update story |
| DELETE | `/api/stories/:id` | App 2 — delete story |

---

## Curl Tests

```bash
# Test live API
bash test/curl-tests.sh

# Test local
API=http://localhost:3001 bash test/curl-tests.sh

# With your real admin password
ADMIN_PASSWORD=yourpass bash test/curl-tests.sh
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
4. To link to a specific story: `story.html?id=2`

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
3. The script auto-loads stories on page load.
   JWT token must be in `localStorage` as `phonics_admin_token` (already handled by your existing login flow).

---

## Folder Structure

```
phonics-api-fixed/
├── src/
│   ├── server.js                 ← entry point
│   ├── db/
│   │   ├── init.js               ← pg + in-memory fallback
│   │   └── migrate-standalone.js ← run once: node src/db/migrate-standalone.js
│   ├── routes/
│   │   ├── stories.js
│   │   ├── events.js
│   │   ├── emails.js
│   │   ├── admin.js
│   │   └── subscriptions.js
│   ├── controllers/
│   │   └── stories.js
│   └── middleware/
│       └── auth.js
├── integration/
│   ├── app1/
│   │   ├── config.js             ← copy to phonics77-app/js/
│   │   └── stories-loader.js     ← copy to phonics77-app/js/
│   └── app2/
│       └── stories-admin.js      ← copy to phonics-admin/js/
├── test/
│   ├── curl-tests.sh             ← bash test/curl-tests.sh
│   └── sample-data.json          ← reference payloads
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
3. Build: `npm install` / Start: `node src/server.js`
4. Add all env vars from `.env.example`
5. After first deploy: open Render Shell → `node src/db/migrate-standalone.js`
