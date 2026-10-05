const express = require('express');
const auth = require('../lib/auth');
const coverage = require('../lib/coverage');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ groups: coverage.listGrouped(), statuses: coverage.STATUSES });
});

router.post('/items', (req, res) => {
  try {
    res.status(201).json({ success: true, item: coverage.createItem(req.body || {}, req.user) });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.patch('/items/:id', (req, res) => {
  try {
    const item = coverage.updateItem(req.params.id, req.body || {}, req.user);
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });
    res.json({ success: true, item });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/items/:id', (req, res) => {
  if (!coverage.deleteItem(req.params.id, req.user)) return res.status(404).json({ success: false, error: 'Item not found' });
  res.json({ success: true });
});

router.get('/history', auth.requireAdmin, (req, res) => {
  res.json({ events: coverage.history(req.query.limit) });
});

module.exports = router;
