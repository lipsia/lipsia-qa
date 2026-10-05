// Run history and usage statistics (admin dashboard).
const { db } = require('./db');

// Number of most recent runs that keep their detailed failure log.
const FAILURE_LOG_KEEP = 20;

const LIST_COLUMNS = `
  id, ts, user_id AS userId, username, tag, command, spec, sut, headed, success,
  exit_code AS exitCode, duration_ms AS durationMs, result_label AS resultLabel,
  failure_kind AS failureKind, failure_reason AS failureReason,
  tests_total AS testsTotal, tests_passed AS testsPassed, tests_failed AS testsFailed,
  (failure_log IS NOT NULL) AS hasLog
`;

const DAILY_COLUMNS = `
  substr(ts, 1, 10) AS day,
  COUNT(*) AS totalRuns,
  SUM(success) AS successRuns,
  SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failedRuns
`;

const stmts = {
  insert: db.prepare(`
    INSERT INTO run_log (ts, user_id, username, tag, command, spec, sut, headed, success, exit_code, duration_ms,
                         result_label, failure_kind, failure_reason, tests_total, tests_passed, tests_failed, failure_log)
    VALUES (@ts, @userId, @username, @tag, @command, @spec, @sut, @headed, @success, @exitCode, @durationMs,
            @resultLabel, @failureKind, @failureReason, @testsTotal, @testsPassed, @testsFailed, @failureLog)
  `),
  pruneLogs: db.prepare(`
    UPDATE run_log SET failure_log = NULL
    WHERE failure_log IS NOT NULL
      AND id NOT IN (SELECT id FROM run_log WHERE failure_log IS NOT NULL ORDER BY id DESC LIMIT ?)
  `),
  aggregate: db.prepare(`
    SELECT COALESCE(username, '(deleted)') AS username, MAX(tag) AS tag,
           COUNT(*) AS totalRuns, SUM(headed) AS headedRuns, SUM(success) AS successRuns,
           SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failedRuns,
           SUM(duration_ms) AS totalDurationMs, MAX(ts) AS lastRunAt
    FROM run_log GROUP BY username ORDER BY totalRuns DESC
  `),
  recent: db.prepare(`SELECT ${LIST_COLUMNS} FROM run_log ORDER BY id DESC LIMIT ?`),
  recentByUser: db.prepare(`
    SELECT ${LIST_COLUMNS} FROM run_log
    WHERE username LIKE ? ESCAPE '\\' COLLATE NOCASE ORDER BY id DESC LIMIT ?
  `),
  detail: db.prepare(`SELECT ${LIST_COLUMNS}, failure_log AS failureLog FROM run_log WHERE id = ?`),
  daily: db.prepare(`SELECT ${DAILY_COLUMNS} FROM run_log WHERE ts >= ? GROUP BY day ORDER BY day`),
  dailyByTag: db.prepare(`SELECT ${DAILY_COLUMNS} FROM run_log WHERE ts >= ? AND tag = ? GROUP BY day ORDER BY day`),
  dailyUntagged: db.prepare(`SELECT ${DAILY_COLUMNS} FROM run_log WHERE ts >= ? AND tag IS NULL GROUP BY day ORDER BY day`),
};

const numberOrNull = (n) => (Number.isFinite(n) ? n : null);

function record(run) {
  try {
    stmts.insert.run({
      ts: new Date().toISOString(),
      userId: run.userId || null,
      username: run.username || null,
      tag: run.tag || null,
      command: run.command || null,
      spec: run.spec || null,
      sut: run.sut || null,
      headed: run.headed ? 1 : 0,
      success: run.success ? 1 : 0,
      exitCode: run.exitCode ?? null,
      durationMs: run.durationMs || 0,
      resultLabel: run.resultLabel || null,
      failureKind: run.failureKind || null,
      failureReason: run.failureReason || null,
      testsTotal: numberOrNull(run.testsTotal),
      testsPassed: numberOrNull(run.testsPassed),
      testsFailed: numberOrNull(run.testsFailed),
      failureLog: run.failureLog || null,
    });
    if (run.failureLog) stmts.pruneLogs.run(FAILURE_LOG_KEEP);
  } catch (err) {
    console.error('[Usage] Failed to record run:', err.message);
  }
}

const toRun = (r) => ({ ...r, headed: !!r.headed, success: !!r.success, hasLog: !!r.hasLog });

const matchesTag = (rowTag, filter) => (filter === 'untagged' ? !rowTag : rowTag === filter);

/** @param {string} [filterTag] 'po' | 'dev' | 'untagged' */
function recent(limit = 100, filterUsername, filterTag) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 1000);
  let rows;
  if (filterUsername) {
    rows = stmts.recentByUser.all(`${filterUsername.replace(/[\\%_]/g, '\\$&')}%`, lim);
  } else {
    rows = stmts.recent.all(filterTag ? Math.min(lim * 5, 5000) : lim);
  }
  if (filterTag) rows = rows.filter((r) => matchesTag(r.tag, filterTag)).slice(0, lim);
  return rows.map(toRun);
}

function runDetail(id) {
  const row = stmts.detail.get(id);
  return row ? { ...toRun(row), failureLog: row.failureLog || null } : null;
}

function aggregate() {
  return stmts.aggregate.all().map((r) => ({
    ...r,
    headedRuns: r.headedRuns || 0,
    successRuns: r.successRuns || 0,
    failedRuns: r.failedRuns || 0,
    totalDurationMs: r.totalDurationMs || 0,
  }));
}

/** Daily run counts for the last `days` days, oldest first, without gaps. */
function dailyCounts(days = 30, filterTag) {
  const span = Math.min(Math.max(parseInt(days, 10) || 30, 1), 365);
  const since = new Date();
  since.setDate(since.getDate() - (span - 1));
  const sinceDay = since.toISOString().slice(0, 10);

  const rows = filterTag === 'untagged' ? stmts.dailyUntagged.all(sinceDay)
    : filterTag ? stmts.dailyByTag.all(sinceDay, filterTag)
      : stmts.daily.all(sinceDay);
  const byDay = new Map(rows.map((r) => [r.day, r]));

  return Array.from({ length: span }, (_, i) => {
    const d = new Date(since);
    d.setDate(since.getDate() + i);
    const day = d.toISOString().slice(0, 10);
    const r = byDay.get(day);
    return { day, totalRuns: r ? r.totalRuns : 0, successRuns: r ? r.successRuns || 0 : 0, failedRuns: r ? r.failedRuns || 0 : 0 };
  });
}

module.exports = { record, recent, runDetail, aggregate, dailyCounts };
