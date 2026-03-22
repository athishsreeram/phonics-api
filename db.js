/**
 * src/db.js
 * Smart database layer.
 * - If DATABASE_URL is set → uses PostgreSQL (Neon / any Postgres)
 * - Otherwise            → uses in-memory store (dev / cold start safety)
 */

let pool = null;
let dbMode = 'memory';

if (process.env.DATABASE_URL) {
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    pool.on('error', (err) => {
      console.error('[DB] Unexpected pool error:', err.message);
    });
    dbMode = 'postgres';
    console.log('[DB] PostgreSQL connected ✓');
  } catch (e) {
    console.warn('[DB] pg module missing or connection failed — falling back to memory:', e.message);
    pool = null;
    dbMode = 'memory';
  }
} else {
  console.warn('[DB] DATABASE_URL not set — using in-memory store');
}

// ─── In-Memory Store ─────────────────────────────────────────────────────────
const mem = {
  stories: [
    {
      id: 1,
      title: 'The Cat Sat',
      level: 'cvc',
      content: 'The cat sat on the mat. The cat is fat. Pat the cat.',
      words: ['cat', 'sat', 'mat', 'fat', 'pat'],
      image_url: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 2,
      title: 'The Big Red Hen',
      level: 'blend',
      content: 'The big red hen can run. She runs in the sun. The sun is fun!',
      words: ['big', 'red', 'hen', 'run', 'sun', 'fun'],
      image_url: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 3,
      title: 'Ship and Shell',
      level: 'digraph',
      content: 'The ship is on the sea. A shell sits on the ship. What a shell!',
      words: ['ship', 'shell', 'she', 'the', 'on'],
      image_url: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
  nextId: 4,
};

// ─── Unified Query Interface ─────────────────────────────────────────────────
const db = {
  mode: dbMode,

  async query(sql, params = []) {
    if (pool) {
      const client = await pool.connect();
      try {
        return await client.query(sql, params);
      } finally {
        client.release();
      }
    }
    throw new Error('query() called in memory mode — use db.stories.*');
  },

  // Story helpers — abstract over Postgres vs memory
  stories: {
    async getAll() {
      if (pool) {
        const r = await db.query('SELECT * FROM stories ORDER BY created_at DESC');
        return r.rows;
      }
      return [...mem.stories].sort((a, b) =>
        new Date(b.created_at) - new Date(a.created_at)
      );
    },

    async getById(id) {
      if (pool) {
        const r = await db.query('SELECT * FROM stories WHERE id = $1', [id]);
        return r.rows[0] || null;
      }
      return mem.stories.find(s => s.id === Number(id)) || null;
    },

    async create(data) {
      const { title, level, content, words, image_url } = data;
      const wordsArr = Array.isArray(words) ? words : (words || []);
      if (pool) {
        const r = await db.query(
          `INSERT INTO stories (title, level, content, words, image_url)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [title, level || 'general', content, JSON.stringify(wordsArr), image_url || null]
        );
        return r.rows[0];
      }
      const now = new Date().toISOString();
      const story = {
        id: mem.nextId++,
        title,
        level: level || 'general',
        content,
        words: wordsArr,
        image_url: image_url || null,
        created_at: now,
        updated_at: now,
      };
      mem.stories.push(story);
      return story;
    },

    async update(id, data) {
      const { title, level, content, words, image_url } = data;
      const wordsArr = Array.isArray(words) ? words : (words || []);
      if (pool) {
        const r = await db.query(
          `UPDATE stories
           SET title=$1, level=$2, content=$3, words=$4, image_url=$5, updated_at=NOW()
           WHERE id=$6
           RETURNING *`,
          [title, level, content, JSON.stringify(wordsArr), image_url || null, id]
        );
        return r.rows[0] || null;
      }
      const idx = mem.stories.findIndex(s => s.id === Number(id));
      if (idx === -1) return null;
      mem.stories[idx] = {
        ...mem.stories[idx],
        title: title ?? mem.stories[idx].title,
        level: level ?? mem.stories[idx].level,
        content: content ?? mem.stories[idx].content,
        words: wordsArr.length ? wordsArr : mem.stories[idx].words,
        image_url: image_url !== undefined ? image_url : mem.stories[idx].image_url,
        updated_at: new Date().toISOString(),
      };
      return mem.stories[idx];
    },

    async delete(id) {
      if (pool) {
        const r = await db.query('DELETE FROM stories WHERE id=$1 RETURNING *', [id]);
        return r.rows[0] || null;
      }
      const idx = mem.stories.findIndex(s => s.id === Number(id));
      if (idx === -1) return null;
      const [deleted] = mem.stories.splice(idx, 1);
      return deleted;
    },
  },
};

module.exports = db;
