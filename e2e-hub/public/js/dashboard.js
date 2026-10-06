(async function () {
  const { api, escapeHtml, toast, openModal, formatDuration, formatDateTime, debounce, readPref, writePref, countUp, stagger, reveal } = Hub;
  await Hub.initShell('dashboard');

  const PREFS_KEY = 'e2e-hub-dashboard-prefs';
  const prefs = { tag: '', days: 30, ...readPref(PREFS_KEY, {}) };
  const $ = (id) => document.getElementById(id);
  const tooltip = $('tooltip');
  const TAG_LABELS = { po: 'PO', dev: 'Dev' };

  function syncSegmented() {
    document.querySelectorAll('#tag-filter button').forEach((b) => b.classList.toggle('active', b.dataset.tag === prefs.tag));
    document.querySelectorAll('#days-filter button').forEach((b) => b.classList.toggle('active', Number(b.dataset.days) === prefs.days));
  }

  const tagQuery = () => (prefs.tag ? `&tag=${encodeURIComponent(prefs.tag)}` : '');
  const matchesTag = (tag) => !prefs.tag || (prefs.tag === 'untagged' ? !tag : tag === prefs.tag);

  // ── KPIs and per-user ──────────────────────────────────────────────────
  function renderKpis(stats) {
    const total = stats.reduce((n, s) => n + s.totalRuns, 0);
    const passed = stats.reduce((n, s) => n + s.successRuns, 0);
    const duration = stats.reduce((n, s) => n + s.totalDurationMs, 0);
    const headed = stats.reduce((n, s) => n + s.headedRuns, 0);
    const rate = total ? Math.round((passed / total) * 100) : 0;
    const kpi = (label, sub, accent) => `
      <div class="card kpi ${accent ? 'accent' : ''}"><div class="kpi-label">${label}</div><div class="kpi-value">0</div><div class="kpi-sub">${sub}</div></div>`;
    $('kpis').innerHTML = [
      kpi('Total runs', `${headed} with live view`, true),
      kpi('Success rate', `${passed} passed · ${total - passed} failed`),
      kpi('Test time', total ? `Ø ${formatDuration(duration / total)} per run` : '–'),
      kpi('Active users', 'with at least one run'),
    ].join('');
    const values = $('kpis').querySelectorAll('.kpi-value');
    countUp(values[0], total);
    countUp(values[1], rate, { format: (v) => `${Math.round(v)}%` });
    countUp(values[2], duration, { format: formatDuration });
    countUp(values[3], stats.length);
    reveal($('kpis'), '.kpi');
  }

  function renderPerUser(stats) {
    if (!stats.length) {
      $('per-user').innerHTML = '<div class="empty"><strong>No runs yet</strong></div>';
      return;
    }
    const max = Math.max(...stats.map((s) => s.totalRuns));
    $('per-user').innerHTML = `<div class="user-bars">${stats.slice(0, 12).map((s, i) => `
      <div>
        <div class="user-bar-head">
          <span><strong>${escapeHtml(s.username)}</strong>${s.tag ? ` <span class="badge">${TAG_LABELS[s.tag] || s.tag}</span>` : ''}</span>
          <span class="muted nowrap">${s.totalRuns} runs · ${s.totalRuns ? Math.round((s.successRuns / s.totalRuns) * 100) : 0}%</span>
        </div>
        <div class="progress grow-x" style="--i:${i};width:${Math.max(6, (s.totalRuns / max) * 100)}%">
          <span style="width:${(s.successRuns / s.totalRuns) * 100}%;background:var(--success)"></span>
          <span style="width:${(s.failedRuns / s.totalRuns) * 100}%;background:var(--danger)"></span>
        </div>
      </div>`).join('')}</div>`;
  }

  async function loadStats() {
    const { stats } = await api('/usage');
    const filtered = stats.filter((s) => matchesTag(s.tag));
    renderKpis(filtered);
    renderPerUser(filtered);
  }

  // ── Timeseries ─────────────────────────────────────────────────────────
  function renderTimeseries(points, animate = true) {
    const el = $('timeseries');
    const W = Math.max(320, el.clientWidth);
    const H = el.clientHeight || 240;
    const pad = { top: 8, right: 8, bottom: 24, left: 32 };
    const innerW = W - pad.left - pad.right;
    const innerH = H - pad.top - pad.bottom;
    const max = Math.max(1, ...points.map((p) => p.totalRuns));
    const niceMax = Math.ceil(max / 4) * 4 || 4;
    const slot = innerW / points.length;
    const barW = Math.max(2, Math.min(28, slot * 0.68));
    const y = (v) => pad.top + innerH - (v / niceMax) * innerH;

    const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const v = Math.round(niceMax * f);
      return `<line x1="${pad.left}" x2="${W - pad.right}" y1="${y(v)}" y2="${y(v)}"/><text x="${pad.left - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    }).join('');
    const labelEvery = Math.ceil(points.length / 8);
    const bars = points.map((p, i) => {
      const x = pad.left + slot * i + (slot - barW) / 2;
      const passedTop = y(p.successRuns);
      const failedTop = y(p.successRuns + p.failedRuns);
      const label = i % labelEvery === 0
        ? `<text x="${x + barW / 2}" y="${H - 6}" text-anchor="middle">${new Date(p.day).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })}</text>` : '';
      return `
        <rect class="hit" x="${pad.left + slot * i}" y="${pad.top}" width="${slot}" height="${innerH}" data-i="${i}"/>
        <g class="bar ${animate ? 'bar-in' : ''}" style="--i:${i}">
        ${p.successRuns ? `<rect class="bar-passed" x="${x}" y="${passedTop}" width="${barW}" height="${y(0) - passedTop}" rx="2" pointer-events="none"/>` : ''}
        ${p.failedRuns ? `<rect class="bar-failed" x="${x}" y="${failedTop}" width="${barW}" height="${passedTop - failedTop}" rx="2" pointer-events="none"/>` : ''}
        </g>
        <g class="axis">${label}</g>`;
    }).join('');

    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Runs per day" style="--baseline:${y(0)}px"><g class="grid axis">${grid}</g>${bars}</svg>`;
    el.querySelectorAll('.hit').forEach((rect) => {
      rect.addEventListener('mousemove', (e) => {
        const p = points[Number(rect.dataset.i)];
        tooltip.innerHTML = `<strong>${new Date(p.day).toLocaleDateString(undefined, { dateStyle: 'medium' })}</strong><br>${p.totalRuns} runs · ${p.successRuns} passed · ${p.failedRuns} failed`;
        tooltip.hidden = false;
        tooltip.style.left = `${e.clientX + 12}px`;
        tooltip.style.top = `${e.clientY + 12}px`;
      });
      rect.addEventListener('mouseleave', () => { tooltip.hidden = true; });
    });
  }

  let lastPoints = [];
  async function loadTimeseries() {
    const { days } = await api(`/usage/timeseries?days=${prefs.days}${tagQuery()}`);
    lastPoints = days;
    renderTimeseries(days);
  }
  window.addEventListener('resize', debounce(() => renderTimeseries(lastPoints, false), 150));

  // ── Recent runs ────────────────────────────────────────────────────────
  function resultCell(r) {
    const label = r.resultLabel || (r.success ? 'Passed' : `Failed (exit ${r.exitCode ?? '?'})`);
    const cls = r.success ? 'passed' : r.failureKind === 'aborted' ? 'aborted' : 'failed';
    return `<span class="result ${cls}"><span class="dot"></span>${escapeHtml(label)}</span>`;
  }

  function specName(spec) {
    if (!spec) return '–';
    return spec.replace(/^cypress\/e2e\//, '').replace(/\.cy\.(js|ts)$/, '');
  }

  async function loadRuns() {
    const user = $('user-search').value.trim();
    const { runs } = await api(`/usage/runs?limit=100${user ? `&user=${encodeURIComponent(user)}` : ''}${tagQuery()}`);
    $('runs').innerHTML = runs.map((r) => `
      <tr>
        <td class="nowrap muted">${formatDateTime(r.ts)}</td>
        <td class="nowrap">${escapeHtml(r.username || '–')}${r.headed ? ' <span class="badge badge-brand">Live</span>' : ''}</td>
        <td><span title="${escapeHtml(r.spec || '')}">${escapeHtml(specName(r.spec))}</span></td>
        <td class="nowrap">${r.sut ? `<span class="badge">${escapeHtml(r.sut)}</span>` : '–'}</td>
        <td>${resultCell(r)}</td>
        <td class="num nowrap">${formatDuration(r.durationMs)}</td>
        <td>${r.failureReason || r.hasLog ? `<div class="reason"><span title="${escapeHtml(r.failureReason || '')}">${escapeHtml(r.failureReason || '')}</span>${r.hasLog ? `<button class="btn btn-sm" data-log="${r.id}" type="button">Log</button>` : ''}</div>` : '<span class="faint">–</span>'}</td>
      </tr>`).join('') || '<tr><td colspan="7" class="empty"><strong>No runs found</strong>Runs appear here once they have finished.</td></tr>';
    stagger($('runs').querySelectorAll('tr'));
  }

  $('runs').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-log]');
    if (!btn) return;
    try {
      const { run } = await api(`/usage/runs/${btn.dataset.log}`);
      openModal({
        title: `Run log · ${specName(run.spec)}`,
        wide: true,
        body: run.failureLog
          ? `<pre class="log-view">${escapeHtml(run.failureLog)}</pre>`
          : '<p class="muted">The detailed log of this run is no longer stored — only the most recent failed runs keep it.</p>',
        actions: run.failureLog ? [
          { label: 'Copy', onClick: () => navigator.clipboard.writeText(run.failureLog).then(() => toast('Log copied', 'success')) },
          { label: 'Close', variant: 'brand' },
        ] : [{ label: 'Close', variant: 'brand' }],
      });
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // ── Wiring ─────────────────────────────────────────────────────────────
  async function loadAll() {
    try {
      await Promise.all([loadStats(), loadTimeseries(), loadRuns()]);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  $('tag-filter').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tag]');
    if (!btn) return;
    prefs.tag = btn.dataset.tag;
    writePref(PREFS_KEY, prefs);
    syncSegmented();
    loadAll();
  });
  $('days-filter').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-days]');
    if (!btn) return;
    prefs.days = Number(btn.dataset.days);
    writePref(PREFS_KEY, prefs);
    syncSegmented();
    loadTimeseries().catch((err) => toast(err.message, 'error'));
  });
  $('user-search').addEventListener('input', debounce(() => loadRuns().catch((err) => toast(err.message, 'error')), 250));
  $('refresh-btn').addEventListener('click', loadAll);

  syncSegmented();
  loadAll();
})();
