/**
 * db/init.js
 * Connects to PostgreSQL (Neon) if DATABASE_URL is set.
 * Falls back to in-memory store if DB is unavailable.
 */

let pgPool = null;
let useMemory = false;

// ─── IN-MEMORY FALLBACK ───────────────────────────────────────────────────────
const memDB = {
  stories: [
    {
      id: 1,
      title: 'The Cat and the Hat',
      level: 1,
      emoji: '🐱',
      content: 'The cat sat on the mat. The cat had a hat. The hat was flat. The cat sat with the hat on the mat.',
      words: ['cat', 'sat', 'mat', 'hat', 'flat'],
      active: true,
      created_at: new Date().toISOString(),
    },
    {
      id: 2,
      title: 'The Big Red Dog',
      level: 2,
      emoji: '🐕',
      content: 'The big red dog ran in the fog. He had a log. He ran past the bog with his log.',
      words: ['big', 'red', 'dog', 'ran', 'fog', 'log', 'bog'],
      active: true,
      created_at: new Date().toISOString(),
    },
    {
      id: 3,
      title: 'The Sun and the Rain',
      level: 3,
      emoji: '☀️',
      content: 'The sun came out after the rain. The plain was wet and the train was late. Jane waited in the lane.',
      words: ['sun', 'rain', 'plain', 'train', 'lane', 'Jane'],
      active: true,
      created_at: new Date().toISOString(),
    },
  ],
  events: [],
  emails: [],
  users: [],
  subscriptions: [],
  nextId: { stories: 4, events: 1, emails: 1 },
};

function getMemNextId(table) {
  const id = memDB.nextId[table] || 1;
  memDB.nextId[table] = id + 1;
  return id;
}

// ─── QUERY WRAPPER ────────────────────────────────────────────────────────────
async function query(sql, params = []) {
  if (useMemory) {
    throw new Error('Direct SQL not supported in memory mode — use the mem helpers');
  }
  const client = await pgPool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function initDB() {
  const dbUrl = process.env.DATABASE_URL;

  if (!dbUrl) {
    console.warn('⚠️  DATABASE_URL not set — using in-memory store (data lost on restart)');
    useMemory = true;
    return;
  }

  try {
    const { Pool } = require('pg');
    pgPool = new Pool({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    // Test connection
    await pgPool.query('SELECT 1');
    console.log('✅ Connected to PostgreSQL');

    // Run migrations
    await migrate();
  } catch (err) {
    console.warn(`⚠️  PostgreSQL unavailable (${err.message}) — falling back to in-memory store`);
    useMemory = true;
  }
}

async function migrate() {
  console.log('Running migrations…');
  const sql = `
    CREATE TABLE IF NOT EXISTS stories (
      id          SERIAL PRIMARY KEY,
      title       TEXT NOT NULL,
      level       INTEGER DEFAULT 1,
      emoji       TEXT DEFAULT '📖',
      content     TEXT NOT NULL,
      words       TEXT[],
      active      BOOLEAN DEFAULT TRUE,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS events (
      id          SERIAL PRIMARY KEY,
      type        TEXT NOT NULL,
      session     TEXT,
      url         TEXT,
      ua          TEXT,
      premium     BOOLEAN DEFAULT FALSE,
      data        JSONB,
      ts          BIGINT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS email_leads (
      id          SERIAL PRIMARY KEY,
      email       TEXT UNIQUE NOT NULL,
      name        TEXT,
      source      TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id          SERIAL PRIMARY KEY,
      email       TEXT UNIQUE NOT NULL,
      child_name  TEXT,
      child_age   INTEGER,
      status      TEXT DEFAULT 'free',
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      last_seen   TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id                SERIAL PRIMARY KEY,
      user_id           INTEGER REFERENCES users(id),
      stripe_session_id TEXT UNIQUE,
      stripe_sub_id     TEXT,
      status            TEXT DEFAULT 'trialing',
      plan              TEXT DEFAULT 'monthly',
      created_at        TIMESTAMPTZ DEFAULT NOW(),
      updated_at        TIMESTAMPTZ DEFAULT NOW()
    );

    -- Seed sample stories if empty
    INSERT INTO stories (title, level, emoji, content, words, active)
    SELECT * FROM (VALUES
      ('The Cat and the Hat', 1, '🐱',
       'The cat sat on the mat. The cat had a hat. The hat was flat. The cat sat with the hat on the mat.',
       ARRAY['cat','sat','mat','hat','flat'], TRUE),
      ('The Big Red Dog', 2, '🐕',
       'The big red dog ran in the fog. He had a log. He ran past the bog with his log.',
       ARRAY['big','red','dog','ran','fog','log','bog'], TRUE),
      ('The Sun and the Rain', 3, '☀️',
       'The sun came out after the rain. The plain was wet and the train was late. Jane waited in the lane.',
       ARRAY['sun','rain','plain','train','lane'], TRUE)
    ) AS v(title, level, emoji, content, words, active)
    WHERE NOT EXISTS (SELECT 1 FROM stories LIMIT 1);
  `;

  await pgPool.query(sql);
  console.log('✅ Migrations complete');
}

module.exports = { initDB, query, useMemory: () => useMemory, memDB, getMemNextId };
