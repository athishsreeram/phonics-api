require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const SQL = `
  CREATE TABLE IF NOT EXISTS stories (
    id SERIAL PRIMARY KEY, title TEXT NOT NULL, level INTEGER DEFAULT 1,
    emoji TEXT DEFAULT '📖', content TEXT NOT NULL, words TEXT[],
    active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY, type TEXT NOT NULL, session TEXT, url TEXT, ua TEXT,
    premium BOOLEAN DEFAULT FALSE, data JSONB, ts BIGINT, created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS email_leads (
    id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, source TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, child_name TEXT, child_age INTEGER,
    status TEXT DEFAULT 'free', created_at TIMESTAMPTZ DEFAULT NOW(), last_seen TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS subscriptions (
    id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id),
    stripe_session_id TEXT UNIQUE, stripe_sub_id TEXT, status TEXT DEFAULT 'trialing',
    plan TEXT DEFAULT 'monthly', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
  );
  INSERT INTO stories (title, level, emoji, content, words, active)
  SELECT * FROM (VALUES
    ('The Cat and the Hat',1,'🐱','The cat sat on the mat. The cat had a hat.',ARRAY['cat','sat','mat','hat'],TRUE),
    ('The Big Red Dog',2,'🐕','The big red dog ran in the fog.',ARRAY['big','red','dog','ran','fog'],TRUE),
    ('The Sun and the Rain',3,'☀️','The sun came out after the rain. Jane waited in the lane.',ARRAY['sun','rain','lane'],TRUE)
  ) AS v(title,level,emoji,content,words,active)
  WHERE NOT EXISTS (SELECT 1 FROM stories LIMIT 1);
`;

(async () => {
  try {
    await pool.query(SQL);
    console.log('✅ All tables created and seed data inserted');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  }
})();
