// In-memory brute-force guard for the login endpoints (single-process app).
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

const attemptsByIp = new Map();

function cleanupStale(now) {
  for (const [ip, entry] of attemptsByIp) {
    if (now > entry.resetAt) attemptsByIp.delete(ip);
  }
}

function loginRateLimit(req, res, next) {
  const now = Date.now();
  if (attemptsByIp.size > 10000) cleanupStale(now);

  const entry = attemptsByIp.get(req.ip);
  if (!entry || now > entry.resetAt) {
    attemptsByIp.set(req.ip, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }
  if (entry.count >= MAX_ATTEMPTS) {
    res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
    return res.status(429).json({ error: 'Too many attempts — try again later' });
  }
  entry.count += 1;
  next();
}

module.exports = { loginRateLimit };
