const express = require('express');
const auth = require('../lib/auth');
const { loginRateLimit } = require('../lib/rateLimit');

const router = express.Router();

router.post('/login', loginRateLimit, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const user = await auth.verifyUser(username, password);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  auth.setSessionCookie(res, auth.signToken(user), { secure: req.secure });
  res.json({ success: true, user });
});

router.post('/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ success: true });
});

router.get('/me', auth.requireAuth, (req, res) => {
  res.json({ id: req.user.sub, username: req.user.username, role: req.user.role });
});

// The login page switches to "create first admin" mode while no user exists.
router.get('/bootstrap-status', (req, res) => {
  res.json({ bootstrapNeeded: !auth.hasAnyUser() });
});

router.post('/bootstrap', loginRateLimit, async (req, res) => {
  if (auth.hasAnyUser()) return res.status(403).json({ error: 'Setup already completed — sign in instead' });
  const { username, password } = req.body || {};
  try {
    const user = await auth.createUser(username, password, 'admin');
    auth.setSessionCookie(res, auth.signToken(user), { secure: req.secure });
    res.status(201).json({ success: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
