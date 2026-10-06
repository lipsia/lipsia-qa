const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('./db');

const COOKIE_NAME = 'e2e_hub_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const MIN_PASSWORD_LENGTH = 8;
const ROLES = ['admin', 'user'];
// Optional user tag, used to break down usage statistics (product owner vs. developer).
const TAGS = ['po', 'dev'];

let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[Auth] SESSION_SECRET not set — using an ephemeral secret, sessions end on restart.');
}

const stmts = {
  findByUsername: db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE'),
  insert: db.prepare('INSERT INTO users (id, username, password_hash, role, tag, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
  updatePassword: db.prepare('UPDATE users SET password_hash = ? WHERE username = ? COLLATE NOCASE'),
  updateRole: db.prepare('UPDATE users SET role = ? WHERE username = ? COLLATE NOCASE'),
  updateTag: db.prepare('UPDATE users SET tag = ? WHERE username = ? COLLATE NOCASE'),
  delete: db.prepare('DELETE FROM users WHERE username = ? COLLATE NOCASE'),
  list: db.prepare('SELECT id, username, role, tag, created_at FROM users ORDER BY created_at ASC'),
  count: db.prepare('SELECT COUNT(*) AS c FROM users'),
  countAdmins: db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'"),
};

const normalizeRole = (role) => (role === 'admin' ? 'admin' : 'user');
const normalizeTag = (tag) => (TAGS.includes(tag) ? tag : null);

function toPublicUser(row) {
  return { id: row.id, username: row.username, role: row.role, tag: row.tag || null, createdAt: row.created_at };
}

function validatePassword(password) {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
}

async function createUser(username, password, role = 'user', tag = null) {
  const name = String(username || '').trim();
  if (!name) throw new Error('Username is required');
  if (!/^[\w.@-]{2,64}$/.test(name)) throw new Error('Username may only contain letters, digits and . _ @ -');
  validatePassword(password);
  if (stmts.findByUsername.get(name)) throw new Error(`User '${name}' already exists`);

  const row = {
    id: crypto.randomUUID(),
    username: name,
    role: normalizeRole(role),
    tag: normalizeTag(tag),
    created_at: new Date().toISOString(),
  };
  stmts.insert.run(row.id, row.username, await bcrypt.hash(password, 10), row.role, row.tag, row.created_at);
  return toPublicUser(row);
}

async function verifyUser(username, password) {
  const row = stmts.findByUsername.get(String(username || ''));
  if (!row || !(await bcrypt.compare(String(password || ''), row.password_hash))) return null;
  return toPublicUser(row);
}

async function changePassword(username, newPassword) {
  validatePassword(newPassword);
  if (!stmts.findByUsername.get(username)) throw new Error(`User '${username}' not found`);
  stmts.updatePassword.run(await bcrypt.hash(newPassword, 10), username);
}

function updateUser(username, { role, tag } = {}) {
  const row = stmts.findByUsername.get(username);
  if (!row) throw new Error(`User '${username}' not found`);
  if (role !== undefined) {
    if (row.role === 'admin' && normalizeRole(role) !== 'admin' && stmts.countAdmins.get().c <= 1) {
      throw new Error('At least one admin must remain');
    }
    stmts.updateRole.run(normalizeRole(role), username);
  }
  if (tag !== undefined) stmts.updateTag.run(normalizeTag(tag), username);
  return toPublicUser(stmts.findByUsername.get(username));
}

function deleteUser(username) {
  const row = stmts.findByUsername.get(username);
  if (!row) return false;
  if (row.role === 'admin' && stmts.countAdmins.get().c <= 1) throw new Error('The last admin cannot be deleted');
  return stmts.delete.run(username).changes > 0;
}

function listUsers() {
  return stmts.list.all().map(toPublicUser);
}

function getUserTag(username) {
  const row = stmts.findByUsername.get(username);
  return row ? row.tag || null : null;
}

function hasAnyUser() {
  return stmts.count.get().c > 0;
}

function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username, role: user.role }, SESSION_SECRET, {
    expiresIn: SESSION_TTL_SECONDS,
  });
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

/** Returns the JWT payload `{ sub, username, role }` of the request, or null. */
function getUserFromRequest(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  try {
    return jwt.verify(token, SESSION_SECRET);
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const user = getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  next();
}

function setSessionCookie(res, token, { secure = false } = {}) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

module.exports = {
  ROLES,
  TAGS,
  MIN_PASSWORD_LENGTH,
  createUser,
  verifyUser,
  changePassword,
  updateUser,
  deleteUser,
  listUsers,
  getUserTag,
  hasAnyUser,
  signToken,
  getUserFromRequest,
  requireAuth,
  requireAdmin,
  setSessionCookie,
  clearSessionCookie,
};
