const express = require('express');
const runner = require('../lib/runner');

const router = express.Router();

const processId = (req) => parseInt(req.params.id, 10);

// Maps RunError to an HTTP response; everything else becomes a 500.
const handle = (fn) => (req, res) => {
  try {
    const result = fn(req, res);
    if (result !== undefined) res.json(result);
  } catch (err) {
    if (err instanceof runner.RunError) {
      return res.status(err.status).json({ success: false, error: err.message, ...err.extra });
    }
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
};

router.post('/runs', handle((req) => runner.start(req.user, req.body || {}, { protocol: req.protocol, hostname: req.hostname })));

router.post('/runs/preview', handle((req) => ({ command: runner.previewCommand(req.body || {}) })));

router.get('/processes', handle((req) => runner.list(req.user)));

router.get('/processes/:id', handle((req) => runner.get(req.user, processId(req))));

router.get('/processes/:id/stream', (req, res) => runner.stream(req.user, processId(req), req, res));

router.post('/processes/:id/kill', handle((req) => runner.kill(req.user, processId(req))));

router.delete('/processes/:id', handle((req) => {
  runner.dismiss(req.user, processId(req));
  return { success: true };
}));

router.get('/processes/:id/videos', handle((req) => ({
  videos: runner.videosOf(req.user, processId(req)).map(({ file, downloaded }) => ({ file, downloaded })),
})));

router.get('/processes/:id/videos/:file', handle((req, res) => {
  res.sendFile(runner.videoPath(req.user, processId(req), req.params.file));
}));

router.post('/processes/:id/videos/:file/downloaded', handle((req) => {
  runner.markVideoDownloaded(req.user, processId(req), req.params.file);
  return { success: true };
}));

module.exports = router;
