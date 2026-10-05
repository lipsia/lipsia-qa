// Turns the raw output of a Cypress run into what the Control Center shows: a filtered
// terminal stream, a result label and a detailed failure log.

// Emitted by cypress.config.js (after:spec) — keep in sync.
const SPEC_REPORT_MARKER = '[cc:spec-report]';
const FAILURE_LOG_MAX_CHARS = 20000;

/** Collects spec report marker lines from raw stdout (chunk boundaries may split lines). */
function createSpecReportCollector() {
  let carry = '';
  const reports = [];

  const consumeLine = (line) => {
    const idx = line.indexOf(SPEC_REPORT_MARKER);
    if (idx === -1) return;
    try {
      reports.push(JSON.parse(line.slice(idx + SPEC_REPORT_MARKER.length).trim()));
    } catch {
      // Truncated line — ignore rather than break the run completion.
    }
  };

  return {
    feed(chunk) {
      const parts = (carry + chunk).split('\n');
      carry = parts.pop();
      parts.forEach(consumeLine);
    },
    flush() {
      if (carry) consumeLine(carry);
      carry = '';
      return reports;
    },
  };
}

/** Drops machine-readable markers and known harmless noise from the terminal stream. */
function createOutputFilter() {
  let carry = '';
  let skipStackFrames = false;

  const shouldDrop = (line) => {
    if (line.includes(SPEC_REPORT_MARKER)) return true;
    if (/^\(node:\d+\)\s*\[DEP\d+\]/.test(line) || /^\(Use `node --trace-deprecation/.test(line)) return true;
    if (/^Warning: We failed to trash the existing run results\.$/.test(line)) return true;
    if (/^This error will not affect or change the exit code\.$/.test(line)) return true;
    if (/^Error: spawn Unknown system error/.test(line)) {
      skipStackFrames = true;
      return true;
    }
    if (skipStackFrames) {
      if (/^\s*at\s/.test(line)) return true;
      skipStackFrames = false;
    }
    if (line.includes("can't open terminal") || line.includes('/dev/tty')) return true;
    return false;
  };

  const filterChunk = (chunk) => {
    const parts = (carry + chunk).split('\n');
    carry = parts.pop();
    const kept = parts.filter((line) => !shouldDrop(line));
    return kept.length ? `${kept.join('\n')}\n` : '';
  };

  return {
    filterChunk,
    flush() {
      if (!carry) return '';
      const rest = carry;
      carry = '';
      return filterChunk(`${rest}\n`);
    },
  };
}

/** Sums up all spec reports of a run (a wildcard pattern runs several specs). */
function summarizeSpecReports(reports) {
  const summary = { specs: [], tests: 0, passes: 0, failures: 0, pending: 0, skipped: 0, failed: [] };
  reports.forEach((r) => {
    const counts = {
      tests: r.tests || 0, passes: r.passes || 0, failures: r.failures || 0,
      pending: r.pending || 0, skipped: r.skipped || 0,
    };
    summary.specs.push({ spec: r.spec || '(unknown)', ...counts });
    Object.keys(counts).forEach((k) => { summary[k] += counts[k]; });
    (r.failed || []).forEach((f) => summary.failed.push({ spec: r.spec || null, title: f.title, error: f.error }));
  });
  return summary;
}

// Process-level failures where no test result is available.
const PROCESS_FAILURE_PATTERNS = [
  { kind: 'crash', label: 'Browser crashed', re: /closed unexpectedly|renderer process|Cypress process crashed|heap out of memory|out of memory/i },
  { kind: 'timeout', label: 'Browser start timed out', re: /Timed out waiting for the browser to connect|Cypress verification timed out/i },
  { kind: 'startup', label: 'Startup error', re: /no spec files were found|Could not find a Cypress configuration file|configFile is invalid|Cannot find module|command not found|Webpack Compilation Error|Cypress failed to start|Unknown systemUnderTest/i },
];

/** Classifies a finished run → `{ kind, label }`. */
function classifyRun({ exitCode, signal, killedBy, summary, output, errorOutput }) {
  if (exitCode === 0) {
    return { kind: 'passed', label: summary.tests ? `${summary.passes}/${summary.tests} tests passed` : 'Passed' };
  }
  if (killedBy) return { kind: 'aborted', label: `Stopped by ${killedBy}` };
  if (signal) return { kind: 'aborted', label: `Stopped (${signal})` };
  if (summary.failures > 0) {
    return {
      kind: 'testFailed',
      label: summary.tests ? `${summary.failures} of ${summary.tests} tests failed` : `${summary.failures} tests failed`,
    };
  }
  const hit = PROCESS_FAILURE_PATTERNS.find((p) => p.re.test(`${output || ''}\n${errorOutput || ''}`));
  if (hit) return { kind: hit.kind, label: hit.label };
  return { kind: 'unknown', label: `Run failed (exit ${exitCode ?? '?'})` };
}

function meaningfulTail(text, count) {
  return String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^[─═┌┐└┘│├┤┬┴┼\s]+$/.test(l) && !l.startsWith('✓'))
    .slice(-count);
}

function tailLines(text, count) {
  const lines = String(text || '').replace(/\s+$/, '').split('\n').slice(-count);
  while (lines.length && !lines[0].trim()) lines.shift();
  return lines.join('\n');
}

/** One-line reason for the dashboard table. */
function failureReasonFor({ result, summary, output, errorOutput }) {
  if (result.kind === 'passed') return null;
  if (summary.failed.length) {
    const f = summary.failed[0];
    const firstLine = String(f.error || '').split('\n').find((l) => l.trim()) || '';
    return `${f.title}: ${firstLine.trim()}`.slice(0, 300);
  }
  if (result.kind === 'aborted') return result.label;
  const tail = meaningfulTail(errorOutput, 3).concat(meaningfulTail(output, 3)).slice(0, 3).join(' ');
  return `${result.label}${tail ? ` — ${tail}` : ''}`.slice(0, 300);
}

function formatDuration(ms) {
  const total = Math.round((ms || 0) / 1000);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  return m < 60 ? `${m}m ${total % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

const indent = (text, prefix = '   ') => String(text).split('\n').map((l) => (l ? prefix + l : l)).join('\n');

/** Detailed log for failed runs (dashboard → "Log"). */
function buildFailureLog({ processId, ts, username, spec, sut, command, exitCode, signal, durationMs, result, summary, output, errorOutput }) {
  const sections = [[
    `Run ${processId} at ${ts}`,
    `User:     ${username || '(unknown)'}`,
    `Stage:    ${sut || '(unknown)'}`,
    `Spec:     ${spec || '(none)'}`,
    `Result:   ${result.label} (${result.kind}, exit ${exitCode ?? '?'}${signal ? `, signal ${signal}` : ''})`,
    `Duration: ${formatDuration(durationMs)}`,
    command ? `Command:  ${command}` : null,
  ].filter(Boolean).join('\n')];

  if (summary.failed.length) {
    const blocks = summary.failed.map((f, i) =>
      `✗ [${i + 1}/${summary.failed.length}] ${f.title}${f.spec ? `\n   ${f.spec}` : ''}\n\n${indent(f.error || '(no error message captured)')}`);
    sections.push(`── Failed tests ──\n\n${blocks.join('\n\n')}`);
  }

  sections.push(summary.specs.length
    ? `── Spec summary ──\n${summary.specs.map((s) =>
      `  ${s.spec} — ${s.tests} tests · ${s.passes} passed · ${s.failures} failed · ${s.pending} pending`).join('\n')}`
    : '── Spec summary ──\n  No spec report received — the run ended before the first spec finished.');

  const errTail = tailLines(errorOutput, 30);
  if (errTail) sections.push(`── stderr (last 30 lines) ──\n${errTail}`);
  const outTail = tailLines(output, 60);
  if (outTail) sections.push(`── Terminal output (last 60 lines) ──\n${outTail}`);

  const log = sections.join('\n\n');
  return log.length > FAILURE_LOG_MAX_CHARS
    ? `${log.slice(0, FAILURE_LOG_MAX_CHARS)}\n\n… (truncated — full log was ${log.length} characters)`
    : log;
}

module.exports = {
  createSpecReportCollector,
  createOutputFilter,
  summarizeSpecReports,
  classifyRun,
  failureReasonFor,
  buildFailureLog,
};
