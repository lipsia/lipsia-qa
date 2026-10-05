// Per-run virtual displays for the Live View. Each headed run gets its own Xvfb display,
// a window manager that maximizes the browser, and a read-only x11vnc server. A single
// websockify gateway (docker/supervisord.conf) routes viewers to the right VNC port via
// tokens written to TOKEN_FILE.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const POOL_START = parseInt(process.env.DISPLAY_POOL_START || '100', 10);
const POOL_SIZE = parseInt(process.env.DISPLAY_POOL_SIZE || '20', 10);
const POOL_GEOMETRY = process.env.DISPLAY_POOL_GEOMETRY || '1920x1080x24';
const TOKEN_FILE = process.env.NOVNC_TOKEN_FILE || '/tmp/novnc-tokens';

// Framebuffer size; the browser window (cypress.config.js) and the Live View popup
// (public/js/runner.js) are sized from it so the stream is always filled edge to edge.
const SCREEN_SIZE = (() => {
  const m = /^(\d+)x(\d+)/.exec(POOL_GEOMETRY);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 1920, height: 1080 };
})();

const XVFB_BIN = '/usr/bin/Xvfb';
const FLUXBOX_BIN = '/usr/bin/fluxbox';
const X11VNC_BIN = '/usr/bin/x11vnc';

// Only available inside the Docker image; locally headed runs use the host display.
const POOL_AVAILABLE = process.env.DISPLAY_POOL_DISABLED !== 'true'
  && fs.existsSync(XVFB_BIN) && fs.existsSync(X11VNC_BIN);

if (!POOL_AVAILABLE) {
  console.log('[DisplayPool] Disabled — Xvfb/x11vnc not found. Headed runs use the host display.');
}

const sessions = new Map(); // displayNum -> session

function nextFreeDisplay() {
  for (let n = POOL_START; n < POOL_START + POOL_SIZE; n++) {
    if (!sessions.has(n)) return n;
  }
  return null;
}

// websockify re-reads the token file on every connection, so it is replaced atomically.
function writeTokenFile() {
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    const lines = Array.from(sessions.values()).map((s) => `${s.token}: localhost:${s.vncPort}`);
    const tmp = `${TOKEN_FILE}.tmp`;
    fs.writeFileSync(tmp, lines.length ? `${lines.join('\n')}\n` : '');
    fs.renameSync(tmp, TOKEN_FILE);
  } catch (err) {
    console.error('[DisplayPool] Failed to write token file:', err.message);
  }
}

const shQuote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;

// Starts a process once the X socket of the display exists; `exec` keeps the target's PID.
function spawnWhenDisplayReady(displayNum, cmd, args, opts = {}) {
  const socket = `/tmp/.X11-unix/X${displayNum}`;
  const wait = `i=0; while [ ! -e ${shQuote(socket)} ] && [ $i -lt 200 ]; do i=$((i+1)); sleep 0.05; done`;
  const target = [cmd, ...args].map(shQuote).join(' ');
  return spawn('/bin/sh', ['-c', `${wait}; exec ${target}`], { stdio: 'ignore', ...opts });
}

function startSession({ username } = {}) {
  if (!POOL_AVAILABLE) return null;

  const displayNum = nextFreeDisplay();
  if (displayNum === null) {
    throw new Error(`No live view slot available — all ${POOL_SIZE} displays are in use`);
  }

  const session = {
    displayNum,
    display: `:${displayNum}`,
    vncPort: 5900 + displayNum,
    token: crypto.randomBytes(12).toString('hex'),
    procs: {},
  };
  sessions.set(displayNum, session);

  try {
    session.procs.xvfb = spawn(XVFB_BIN, [session.display, '-screen', '0', POOL_GEOMETRY, '-ac', '+extension', 'RANDR'], { stdio: 'ignore' });
    if (fs.existsSync(FLUXBOX_BIN)) {
      session.procs.fluxbox = spawnWhenDisplayReady(displayNum, FLUXBOX_BIN, [], {
        env: { ...process.env, DISPLAY: session.display, HOME: '/root' },
      });
    }
    session.procs.x11vnc = spawnWhenDisplayReady(displayNum, X11VNC_BIN, [
      '-display', session.display,
      '-forever', '-shared', '-nopw', '-viewonly',
      '-rfbport', String(session.vncPort),
      '-quiet',
    ]);
    writeTokenFile();
    console.log(`[DisplayPool] Allocated ${session.display} for ${username || 'anonymous'}`);
  } catch (err) {
    releaseSession(displayNum);
    throw err;
  }
  return session;
}

/** Public noVNC URL for a session; VNC_PUBLIC_BASE_URL wins, else `<host>:<VNC_PUBLIC_PORT>`. */
function vncUrlFor(session, { protocol = 'http', hostname } = {}) {
  const base = process.env.VNC_PUBLIC_BASE_URL
    ? process.env.VNC_PUBLIC_BASE_URL.replace(/\/$/, '')
    : `${protocol}://${hostname || 'localhost'}:${process.env.VNC_PUBLIC_PORT || '6080'}`;
  // Query parameters override settings noVNC keeps in localStorage. resize=scale fits the
  // picture into the window without reconfiguring the test's framebuffer.
  const params = new URLSearchParams({
    autoconnect: '1',
    reconnect: '1',
    reconnect_delay: '2000',
    resize: 'scale',
    view_only: '1',
    show_dot: 'false',
    bell: 'off',
    path: `websockify?token=${session.token}`,
  });
  return `${base}/vnc.html?${params.toString()}`;
}

function releaseSession(displayNum) {
  const session = sessions.get(displayNum);
  if (!session) return false;
  Object.values(session.procs).forEach((p) => {
    try { p.kill('SIGKILL'); } catch { /* already gone */ }
  });
  sessions.delete(displayNum);
  writeTokenFile();
  console.log(`[DisplayPool] Released :${displayNum}`);
  return true;
}

function shutdownAll() {
  Array.from(sessions.keys()).forEach(releaseSession);
}

if (POOL_AVAILABLE && !fs.existsSync(TOKEN_FILE)) writeTokenFile();

module.exports = {
  POOL_AVAILABLE,
  SCREEN_SIZE,
  startSession,
  releaseSession,
  shutdownAll,
  vncUrlFor,
};
