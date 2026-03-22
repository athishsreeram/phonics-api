/**
 * middleware/auth.js
 * JWT guard for admin routes.
 */

const jwt = require('jsonwebtoken');

function requireAdmin(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  try {
    const secret = process.env.JWT_SECRET || 'dev-secret-change-in-prod';
    const payload = jwt.verify(token, secret);
    req.admin = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { requireAdmin };
