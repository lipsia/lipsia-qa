const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', '..', 'data', 'e2e-hub.sqlite');

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

// Databases created before the rename to E2E Hub are picked up under the new name.
const LEGACY_DB_FILE = path.join(path.dirname(DB_FILE), 'control-center.sqlite');
if (!fs.existsSync(DB_FILE) && fs.existsSync(LEGACY_DB_FILE)) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(LEGACY_DB_FILE + suffix)) fs.renameSync(LEGACY_DB_FILE + suffix, DB_FILE + suffix);
  }
}

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',
    tag           TEXT,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS run_log (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    ts             TEXT NOT NULL,
    user_id        TEXT,
    username       TEXT,
    tag            TEXT,
    command        TEXT,
    spec           TEXT,
    sut            TEXT,
    headed         INTEGER NOT NULL DEFAULT 0,
    success        INTEGER NOT NULL DEFAULT 0,
    exit_code      INTEGER,
    duration_ms    INTEGER NOT NULL DEFAULT 0,
    result_label   TEXT,
    failure_kind   TEXT,
    failure_reason TEXT,
    tests_total    INTEGER,
    tests_passed   INTEGER,
    tests_failed   INTEGER,
    failure_log    TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_run_log_username ON run_log(username);
  CREATE INDEX IF NOT EXISTS idx_run_log_ts       ON run_log(ts);

  CREATE TABLE IF NOT EXISTS coverage_items (
    id             TEXT PRIMARY KEY,
    group_name     TEXT NOT NULL,
    name           TEXT NOT NULL,
    type           TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'missing',
    tool_framework TEXT NOT NULL DEFAULT '',
    note           TEXT NOT NULL DEFAULT '',
    sort_order     INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS coverage_history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         TEXT NOT NULL,
    item_id    TEXT NOT NULL,
    item_name  TEXT,
    username   TEXT,
    field      TEXT NOT NULL,
    old_value  TEXT,
    new_value  TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_coverage_history_ts ON coverage_history(ts);
`);

module.exports = { db, DB_FILE };
