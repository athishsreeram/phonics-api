/**
 * phonics-api — server.js
 * Production-ready Express server
 * Stack: Node.js + Express + PostgreSQL (Neon) with in-memory fallback
 */

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── CORS ───────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

// Always allow these regardless of env config
const DEFAULT_ORIGINS = [
  'https://phonics77-app.vercel.app',
  'https://athishsreeram.github.io',
  'http://localhost:3000',
  'http://localhost:4000',
  'http://localhost:8000',
  'http://127.0.0.1:5500',
];

const allOrigins = [...new Set([...DEFAULT_ORIGINS, ...ALLOWED_ORIGINS])];

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return cb(null, true);
    if (allOrigins.includes(origin)) return cb(null, true);
    console.warn(`[CORS] Blocked origin: ${origin}`);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ─── DB ───────────────────────────────────────────────────────────────────────
const db = require('./src/db');

// ─── ROUTES ──────────────────────────────────────────────────────────────────
const storiesRouter = require('./routes/stories');
const adminRouter = require('./routes/admin');
const eventsRouter = require('./routes/events');

app.use('/stories', storiesRouter);
app.use('/api/admin', adminRouter);
app.use('/api/events', eventsRouter);

// ─── HEALTH ──────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development',
    db: db.mode,
  });
});

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ ok: false, error: `Route not found: ${req.method} ${req.path}` });
});

// ─── ERROR HANDLER ────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[ERROR]', err.message);
  const status = err.status || 500;
  res.status(status).json({ ok: false, error: err.message });
});

// ─── BOOT ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 phonics-api running on port ${PORT}`);
  console.log(`   DB mode  : ${db.mode}`);
  console.log(`   Env      : ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Origins  : ${allOrigins.join(', ')}\n`);
});

module.exports = app;
