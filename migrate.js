// migrate.js — Run once to create all tables
// Usage: node migrate.js

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const SQL = `
-- ── Users / Profiles ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    TEXT UNIQUE NOT NULL,          -- browser-generated session id
  child_name    TEXT,
  child_age     TEXT,
  email         TEXT,
  goals         TEXT[],
  is_premium    BOOLEAN DEFAULT FALSE,
  stripe_customer_id TEXT,
  onboarded_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_session  ON users(session_id);
CREATE INDEX IF NOT EXISTS idx_users_email    ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_premium  ON users(is_premium);

-- ── Events ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id          BIGSERIAL PRIMARY KEY,
  session_id  TEXT NOT NULL,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  type        TEXT NOT NULL,
  data        JSONB DEFAULT '{}',
  url         TEXT,
  ua          TEXT,
  is_premium  BOOLEAN DEFAULT FALSE,
  ts          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_session  ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_type     ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_ts       ON events(ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_user     ON events(user_id);

-- ── Activity Progress ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_progress (
  id           BIGSERIAL PRIMARY KEY,
  session_id   TEXT NOT NULL,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  activity_id  TEXT NOT NULL,
  attempts     INT DEFAULT 1,
  best_score   INT DEFAULT 0,
  best_pct     INT DEFAULT 0,
  last_score   INT,
  last_pct     INT,
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, activity_id)
);
CREATE INDEX IF NOT EXISTS idx_progress_session  ON activity_progress(session_id);
CREATE INDEX IF NOT EXISTS idx_progress_activity ON activity_progress(activity_id);

-- ── Email Leads ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_leads (
  id         BIGSERIAL PRIMARY KEY,
  email      TEXT NOT NULL,
  name       TEXT,
  source     TEXT,
  session_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(email)
);
CREATE INDEX IF NOT EXISTS idx_leads_email ON email_leads(email);

-- ── Stripe Subscriptions ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id                  BIGSERIAL PRIMARY KEY,
  session_id          TEXT,
  stripe_customer_id  TEXT,
  stripe_sub_id       TEXT UNIQUE,
  status              TEXT,  -- active, trialing, canceled, past_due
  price_id            TEXT,
  amount              INT,   -- cents
  currency            TEXT DEFAULT 'cad',
  trial_end           TIMESTAMPTZ,
  current_period_end  TIMESTAMPTZ,
  canceled_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_subs_customer ON subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subs_status   ON subscriptions(status);

-- ── Streaks ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS streaks (
  session_id  TEXT PRIMARY KEY,
  count       INT DEFAULT 0,
  longest     INT DEFAULT 0,
  last_date   DATE,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(SQL);
    console.log('✅ All tables created successfully');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
