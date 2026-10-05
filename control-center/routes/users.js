const express = require('express');
const auth = require('../lib/auth');

const router = express.Router();

const isSelf = (req, username) => username.toLowerCase() === req.user.username.toLowerCase();

router.get('/', auth.requireAdmin, (req, res) => {
  res.json({ users: auth.listUsers(), roles: auth.ROLES, tags: auth.TAGS });
});

router.post('/', auth.requireAdmin, async (req, res) => {
  const { username, password, role, tag } = req.body || {};
  try {
    res.status(201).json({ success: true, user: await auth.createUser(username, password, role, tag) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:username', auth.requireAdmin, (req, res) => {
  const { role, tag } = req.body || {};
  if (role !== undefined && isSelf(req, req.params.username)) {
    return res.status(400).json({ error: 'You cannot change your own role' });
  }
  try {
    res.json({ success: true, user: auth.updateUser(req.params.username, { role, tag }) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:username', auth.requireAdmin, (req, res) => {
  if (isSelf(req, req.params.username)) return res.status(400).json({ error: 'You cannot delete your own account' });
  try {
    if (!auth.deleteUser(req.params.username)) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Users change their own password; admins may reset any password.
router.post('/:username/password', async (req, res) => {
  if (!isSelf(req, req.params.username) && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    await auth.changePassword(req.params.username, (req.body || {}).password);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
