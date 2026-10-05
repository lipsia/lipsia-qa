const express = require('express');
const project = require('../lib/project');
const runner = require('../lib/runner');
const displayPool = require('../lib/displayPool');

const router = express.Router();

const respond = (fn) => (req, res) => {
  try {
    res.json(fn(req));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

router.get('/stages', respond(() => project.listStages()));

router.get('/specs', respond(() => ({ specs: project.listSpecs() })));

router.get('/step-suites', respond(() => ({ suites: project.listStepSuites() })));

router.get('/run-options', respond(() => ({
  browsers: runner.BROWSERS,
  maxParallelRuns: runner.MAX_PARALLEL_RUNS,
  liveViewAvailable: displayPool.POOL_AVAILABLE,
})));

module.exports = router;
