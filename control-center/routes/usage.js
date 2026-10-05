const express = require('express');
const auth = require('../lib/auth');
const usage = require('../lib/usage');

const router = express.Router();

router.use(auth.requireAdmin);

router.get('/', (req, res) => {
  res.json({ stats: usage.aggregate() });
});

router.get('/runs', (req, res) => {
  res.json({ runs: usage.recent(req.query.limit, req.query.user || null, req.query.tag || null) });
});

router.get('/runs/:id', (req, res) => {
  const run = usage.runDetail(parseInt(req.params.id, 10));
  if (!run) return res.status(404).json({ error: 'Run not found' });
  res.json({ run });
});

router.get('/timeseries', (req, res) => {
  res.json({ days: usage.dailyCounts(req.query.days, req.query.tag || null) });
});

module.exports = router;
