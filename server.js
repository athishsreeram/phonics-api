/**
 * phonics-api — server.js
 * Single source of truth for all 3 apps.
 * Stack: Node.js + Express + PostgreSQL (Neon) + in-memory fallback
 */

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const morgan   = require('morgan');

const { initDB }          = require('./db/init');

const usersRouter = require('./routes/users'); 
const storiesRouter       = require('./routes/stories');
const eventsRouter        = require('./routes/events');
const emailsRouter        = require('./routes/emails');
const adminRouter         = require('./routes/admin');
const subscriptionsRouter = require('./routes/subscriptions');

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── CORS ────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

// Always allow these for local dev
allowedOrigins.push(
  'http://localhost:3000',
  'http://localhost:4000',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
);

app.use(cors({
  origin: (origin, cb) => {
    // Allow no-origin requests (curl, Postman, server-to-server)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    console.warn(`[CORS] Blocked origin: ${origin}`);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(morgan(':method :url :status :res[content-length] - :response-time ms'));

// Raw body for Stripe webhook MUST come before json()
app.use('/api/subscriptions/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── ROUTES ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString(), env: process.env.NODE_ENV || 'development' });
});

app.use('/api/stories',       storiesRouter);
app.use('/api/events',        eventsRouter);
app.use('/api/emails',        emailsRouter);
app.use('/api/admin',         adminRouter);
app.use('/api/subscriptions', subscriptionsRouter);
app.use('/api/users', usersRouter);
 

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message);
  if (err.message.startsWith('CORS:')) {
    return res.status(403).json({ error: err.message });
  }
  res.status(500).json({ error: 'Internal server error', detail: err.message });
});

// ─── BOOT ─────────────────────────────────────────────────────────────────────
(async () => {
  try {
    await initDB();
    app.listen(PORT, () => {
      console.log(`✅ phonics-api listening on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
})();
