// Starts Cypress processes, streams their output via SSE and records the results.
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const project = require('./project');
const displayPool = require('./displayPool');
const usage = require('./usage');
const auth = require('./auth');
const report = require('./runReport');

const BROWSERS = ['electron', 'chrome', 'firefox', 'edge'];
const MAX_PARALLEL_RUNS = 5;
const MAX_CONCURRENT_RUNS_PER_USER = parseInt(process.env.MAX_CONCURRENT_RUNS_PER_USER || '10', 10);
// Delay between the starts of parallel runs, so they don't hit the stage in lockstep.
const PARALLEL_START_DELAY_MS = parseInt(process.env.PARALLEL_START_DELAY_MS || '10000', 10);
const COMPLETED_KEEP = 50;
const VIDEO_ROOT = path.join(project.ROOT, 'test-reports', 'videos');

const active = new Map();    // id -> running process info
const pending = new Map();   // id -> scheduled start of a parallel run
const completed = new Map(); // id -> finished run (output kept for replay)
const clients = new Map();   // id -> SSE responses
let processCounter = 0;

class RunError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const videoDirFor = (id) => path.join(VIDEO_ROOT, `run-${id}`);
const canAccess = (user, info) => user.role === 'admin' || info.userId === user.sub;

function countRunsForUser(userId) {
  let n = 0;
  active.forEach((info) => { if (info.userId === userId) n += 1; });
  pending.forEach((info) => { if (info.userId === userId) n += 1; });
  return n;
}

/** Validates a run request body → normalized options. Throws RunError. */
function normalizeRequest(body = {}) {
  const spec = String(body.spec || '').trim();
  if (!spec) throw new RunError(400, 'No test selected');
  if (!project.isValidSpecPattern(spec)) throw new RunError(400, 'Only specs inside cypress/e2e/ can be run');

  const { stages, defaultStage } = project.listStages();
  const stageName = String(body.stage || defaultStage || '').trim();
  const stage = stages.find((s) => s.name === stageName);
  if (!stage) throw new RunError(400, `Unknown stage '${stageName}'`);

  const browser = BROWSERS.includes(body.browser) ? body.browser : 'electron';
  const headed = Boolean(body.headed);
  const delay = Math.min(Math.max(parseInt(body.delay, 10) || 0, 0), 10000);
  const parallel = Math.min(MAX_PARALLEL_RUNS, Math.max(1, parseInt(body.parallel, 10) || 1));
  if (parallel > 1 && headed) throw new RunError(400, 'Parallel runs are only possible without Live View');

  const suites = project.listStepSuites();
  const stepCutoffs = {};
  Object.entries(body.stepCutoffs || {}).forEach(([suite, key]) => {
    const entry = suites.find((s) => s.suite === suite);
    const value = String(key || '').trim();
    if (!entry || !value) return;
    if (value !== 'none' && !entry.steps.some((s) => s.key === value)) {
      throw new RunError(400, `Unknown step '${value}' for suite '${suite}'`);
    }
    stepCutoffs[entry.envKey] = value;
  });

  return { spec, stage, browser, headed, delay, parallel, recordVideo: Boolean(body.recordVideo), stepCutoffs };
}

function buildArgs(opts, processId) {
  const envPairs = [`systemUnderTest=${opts.stage.name}`];
  if (opts.delay > 0) envPairs.push(`delay=${opts.delay}`);
  Object.entries(opts.stepCutoffs).forEach(([envKey, value]) => envPairs.push(`${envKey}=${value}`));

  const args = ['run', '--spec', opts.spec, '--browser', opts.browser];
  if (opts.headed) args.push('--headed');
  args.push('--env', envPairs.join(','));
  const configParts = [`video=${opts.recordVideo}`];
  if (opts.recordVideo) configParts.push(`videosFolder=test-reports/videos/run-${processId}`);
  args.push('--config', configParts.join(','));
  return args;
}

const displayCommand = (args) => `npx cypress ${args.map((a) => (/[\s*,]/.test(a) ? `'${a}'` : a)).join(' ')}`;

function previewCommand(body) {
  return displayCommand(buildArgs(normalizeRequest(body), '<id>'));
}

function broadcast(id, payload, outLen, errLen) {
  const eventId = `${outLen}:${errLen}`;
  (clients.get(id) || []).forEach((res) => res.write(`id: ${eventId}\ndata: ${JSON.stringify(payload)}\n\n`));
}

// Polls the run's video folder until file sizes are stable (encoding finished).
async function waitForStableVideoFiles(dir, attempts = 20, intervalMs = 500) {
  const list = () => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.mp4')) : []);
  let lastKey = null;
  for (let i = 0; i < attempts; i++) {
    const files = list();
    if (files.length) {
      const key = files.map((f) => `${f}:${fs.statSync(path.join(dir, f)).size}`).join('|');
      if (key === lastKey) return files;
      lastKey = key;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return list();
}

function rememberCompleted(id, info) {
  completed.set(id, info);
  while (completed.size > COMPLETED_KEEP) completed.delete(completed.keys().next().value);
}

function spawnRun({ processId, opts, user, batch, vncSession }) {
  const args = buildArgs(opts, processId);
  const command = displayCommand(args);
  const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', TERM: 'dumb' };
  if (vncSession) {
    env.DISPLAY = vncSession.display;
    env.CC_SCREEN_GEOMETRY = `${displayPool.SCREEN_SIZE.width}x${displayPool.SCREEN_SIZE.height}`;
  }

  const child = spawn('npx', ['cypress', ...args], { cwd: project.ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true, env });
  const info = {
    process: child,
    osPid: child.pid,
    startTime: new Date(),
    command,
    userId: user.sub,
    username: user.username,
    tag: auth.getUserTag(user.username),
    spec: opts.spec,
    sut: opts.stage.name,
    headed: opts.headed,
    recordVideo: opts.recordVideo,
    vncDisplayNum: vncSession ? vncSession.displayNum : null,
    batch,
    output: '',
    errorOutput: '',
  };
  active.set(processId, info);
  console.log(`[Run ${processId}] ${user.username}: ${command}`);

  const stdoutFilter = report.createOutputFilter();
  const stderrFilter = report.createOutputFilter();
  const specReports = report.createSpecReportCollector();

  const append = (type, chunk) => {
    if (!chunk) return;
    if (type === 'output') info.output += chunk; else info.errorOutput += chunk;
    broadcast(processId, { type, data: chunk }, info.output.length, info.errorOutput.length);
  };

  child.stdout.on('data', (data) => {
    const chunk = data.toString();
    specReports.feed(chunk);
    append('output', stdoutFilter.filterChunk(chunk));
  });
  child.stderr.on('data', (data) => append('error', stderrFilter.filterChunk(data.toString())));

  child.on('error', (err) => {
    console.error(`[Run ${processId}] spawn error: ${err.message}`);
    append('error', `Failed to start Cypress: ${err.message}\n`);
  });

  child.on('close', async (exitCode, signal) => {
    if (info.vncDisplayNum != null) displayPool.releaseSession(info.vncDisplayNum);
    append('output', stdoutFilter.flush());
    append('error', stderrFilter.flush());
    active.delete(processId);

    const durationMs = Date.now() - info.startTime.getTime();
    const videos = info.recordVideo
      ? (await waitForStableVideoFiles(videoDirFor(processId))).map((file) => ({ file, downloaded: false }))
      : [];

    const summary = report.summarizeSpecReports(specReports.flush());
    const result = report.classifyRun({
      exitCode, signal, killedBy: info.killedBy, summary, output: info.output, errorOutput: info.errorOutput,
    });
    const success = exitCode === 0;
    const ts = new Date().toISOString();

    rememberCompleted(processId, {
      processId, success, exitCode, resultLabel: result.label, failureKind: result.kind, durationMs,
      output: info.output, errorOutput: info.errorOutput, command, userId: info.userId,
      username: info.username, spec: info.spec, sut: info.sut, videos, completedAt: ts,
    });

    usage.record({
      userId: info.userId,
      username: info.username,
      tag: info.tag,
      command,
      spec: info.spec,
      sut: info.sut,
      headed: info.headed,
      success,
      exitCode,
      durationMs,
      resultLabel: result.label,
      failureKind: result.kind,
      failureReason: report.failureReasonFor({ result, summary, output: info.output, errorOutput: info.errorOutput }),
      testsTotal: summary.tests,
      testsPassed: summary.passes,
      testsFailed: summary.failures,
      failureLog: success ? null : report.buildFailureLog({
        processId, ts, username: info.username, spec: info.spec, sut: info.sut, command, exitCode, signal,
        durationMs, result, summary, output: info.output, errorOutput: info.errorOutput,
      }),
    });

    broadcast(processId, {
      type: 'complete', success, exitCode, resultLabel: result.label, failureKind: result.kind, durationMs,
    }, info.output.length, info.errorOutput.length);
    (clients.get(processId) || []).forEach((res) => res.end());
    clients.delete(processId);
  });

  return { processId, osPid: child.pid, command };
}

/** Starts one or more runs for a user. Returns the API response payload. */
function start(user, body, { protocol, hostname } = {}) {
  const opts = normalizeRequest(body);

  if (opts.stage.protected && body.confirmProtected !== true) {
    throw new RunError(409, `Stage '${opts.stage.name}' is protected — confirm to run against it`, { confirmRequired: true });
  }

  const running = countRunsForUser(user.sub);
  if (running + opts.parallel > MAX_CONCURRENT_RUNS_PER_USER) {
    const free = Math.max(0, MAX_CONCURRENT_RUNS_PER_USER - running);
    throw new RunError(429, `Limit reached: ${running} of ${MAX_CONCURRENT_RUNS_PER_USER} sessions in use, ${free} free, ${opts.parallel} requested`);
  }

  let vncSession = null;
  if (opts.headed && displayPool.POOL_AVAILABLE) {
    try {
      vncSession = displayPool.startSession({ username: user.username });
    } catch (err) {
      throw new RunError(503, err.message);
    }
  }

  const batchId = opts.parallel > 1 ? processCounter + 1 : null;
  const batchFor = (index) => (batchId ? { id: batchId, index: index + 1, size: opts.parallel } : null);

  const primary = spawnRun({ processId: ++processCounter, opts, user, batch: batchFor(0), vncSession });
  const runs = [{ ...primary, startsAt: null }];

  for (let i = 1; i < opts.parallel; i++) {
    const processId = ++processCounter;
    const startsAt = new Date(Date.now() + i * PARALLEL_START_DELAY_MS);
    const batch = batchFor(i);
    const timer = setTimeout(() => {
      pending.delete(processId);
      spawnRun({ processId, opts, user, batch, vncSession: null });
    }, i * PARALLEL_START_DELAY_MS);
    pending.set(processId, {
      timer, startsAt, userId: user.sub, username: user.username, command: primary.command,
      spec: opts.spec, sut: opts.stage.name, headed: false, batch,
    });
    runs.push({ processId, osPid: null, command: primary.command, startsAt });
  }

  return {
    success: true,
    processId: primary.processId,
    osPid: primary.osPid,
    command: primary.command,
    parallel: opts.parallel,
    startDelayMs: opts.parallel > 1 ? PARALLEL_START_DELAY_MS : 0,
    runs,
    vnc: vncSession ? {
      url: displayPool.vncUrlFor(vncSession, { protocol, hostname }),
      screen: displayPool.SCREEN_SIZE,
    } : null,
  };
}

function list(user) {
  const isAdmin = user.role === 'admin';
  const visible = (info) => isAdmin || info.userId === user.sub;
  const common = (id, info) => ({
    id, command: info.command, username: info.username, spec: info.spec, sut: info.sut,
    headed: !!info.headed, batch: info.batch || null, mine: info.userId === user.sub,
  });

  const running = [...active.entries()].filter(([, i]) => visible(i)).map(([id, info]) => ({
    ...common(id, info), osPid: info.osPid, startTime: info.startTime, durationMs: Date.now() - info.startTime,
  }));
  const scheduled = [...pending.entries()].filter(([, i]) => visible(i)).map(([id, info]) => ({
    ...common(id, info), pending: true, startsAt: info.startsAt, startsInMs: Math.max(0, info.startsAt - Date.now()),
  }));

  return {
    processes: [...running, ...scheduled],
    limit: { perUser: MAX_CONCURRENT_RUNS_PER_USER, used: countRunsForUser(user.sub) },
  };
}

function get(user, id) {
  const info = active.get(id);
  if (info) {
    if (!canAccess(user, info)) throw new RunError(403, 'Forbidden');
    return { id, isRunning: true, command: info.command, startTime: info.startTime, username: info.username };
  }
  const done = completed.get(id);
  if (!done) throw new RunError(404, 'Process not found');
  if (!canAccess(user, done)) throw new RunError(403, 'Forbidden');
  const { output, errorOutput, ...rest } = done;
  return { id, isRunning: false, ...rest };
}

/** SSE stream. Last-Event-ID ("<outLen>:<errLen>") lets reconnecting clients resume. */
function stream(user, id, req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const info = active.get(id) || completed.get(id);
  const fail = (message) => {
    res.write(`data: ${JSON.stringify({ type: 'error', data: message })}\n\n`);
    res.end();
  };
  if (!info) return fail('Process not found');
  if (!canAccess(user, info)) return fail('Forbidden');

  const m = /^(\d+):(\d+)$/.exec(req.headers['last-event-id'] || '');
  const outLen = m ? Number(m[1]) : 0;
  const errLen = m ? Number(m[2]) : 0;
  const outTail = (info.output || '').slice(outLen);
  const errTail = (info.errorOutput || '').slice(errLen);
  const eventId = `${info.output.length}:${info.errorOutput.length}`;
  if (outTail) res.write(`id: ${eventId}\ndata: ${JSON.stringify({ type: 'output', data: outTail })}\n\n`);
  if (errTail) res.write(`id: ${eventId}\ndata: ${JSON.stringify({ type: 'error', data: errTail })}\n\n`);

  if (!active.has(id)) {
    res.write(`data: ${JSON.stringify({
      type: 'complete', success: info.success, exitCode: info.exitCode, resultLabel: info.resultLabel, durationMs: info.durationMs,
    })}\n\n`);
    return res.end();
  }

  if (!clients.has(id)) clients.set(id, []);
  clients.get(id).push(res);
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15000);
  req.on('close', () => {
    clearInterval(heartbeat);
    const list = clients.get(id) || [];
    const idx = list.indexOf(res);
    if (idx > -1) list.splice(idx, 1);
  });
}

function kill(user, id) {
  const scheduled = pending.get(id);
  if (scheduled) {
    if (!canAccess(user, scheduled)) throw new RunError(403, 'Forbidden');
    clearTimeout(scheduled.timer);
    pending.delete(id);
    return { success: true, pending: true };
  }

  const info = active.get(id);
  if (!info) throw new RunError(404, 'Process not found');
  if (!canAccess(user, info)) throw new RunError(403, 'Forbidden');
  info.killedBy = user.username;

  // Cypress spawns a process tree; kill the whole group (spawned with detached: true).
  try {
    if (process.platform === 'win32') execSync(`taskkill /PID ${info.osPid} /T /F`, { stdio: 'ignore' });
    else process.kill(-info.osPid, 'SIGKILL');
  } catch {
    try { info.process.kill('SIGKILL'); } catch { /* already gone */ }
  }
  return { success: true };
}

function completedForUser(user, id) {
  const info = completed.get(id);
  if (!info) throw new RunError(404, 'Process not found');
  if (!canAccess(user, info)) throw new RunError(403, 'Forbidden');
  return info;
}

function videoPath(user, id, file) {
  const info = completedForUser(user, id);
  const match = info.videos.find((v) => v.file === file);
  if (!match) throw new RunError(404, 'Video not found');
  const filePath = path.join(videoDirFor(id), match.file);
  if (!fs.existsSync(filePath)) throw new RunError(404, 'Video file missing on disk');
  return filePath;
}

function markVideoDownloaded(user, id, file) {
  const match = completedForUser(user, id).videos.find((v) => v.file === file);
  if (!match) throw new RunError(404, 'Video not found');
  match.downloaded = true;
}

/** Dismisses a finished run and deletes recordings that were never downloaded. */
function dismiss(user, id) {
  const info = completedForUser(user, id);
  const dir = videoDirFor(id);
  info.videos.filter((v) => !v.downloaded).forEach((v) => {
    try { fs.unlinkSync(path.join(dir, v.file)); } catch { /* already gone */ }
  });
  try {
    if (fs.existsSync(dir) && !fs.readdirSync(dir).length) fs.rmdirSync(dir);
  } catch { /* not empty */ }
  completed.delete(id);
}

function shutdown() {
  pending.forEach((p) => clearTimeout(p.timer));
  active.forEach((info) => {
    try { process.kill(-info.osPid, 'SIGKILL'); } catch { /* already gone */ }
  });
  displayPool.shutdownAll();
}

module.exports = {
  RunError,
  BROWSERS,
  MAX_PARALLEL_RUNS,
  start,
  previewCommand,
  list,
  get,
  stream,
  kill,
  videosOf: (user, id) => completedForUser(user, id).videos,
  videoPath,
  markVideoDownloaded,
  dismiss,
  shutdown,
};
