(async function () {
  const { api, html, escapeHtml, toast, confirmDialog, formatDuration, debounce, readPref, writePref } = CC;
  await CC.initShell('runner');

  const PREFS_KEY = 'cc-runner-prefs';
  const LAST_RUN_KEY = 'cc-last-run';
  const prefs = { spec: '', stage: '', browser: 'electron', delay: 0, parallel: 1, headed: false, recordVideo: false, cutoffs: {}, ...readPref(PREFS_KEY, {}) };
  const savePrefs = () => writePref(PREFS_KEY, prefs);

  const $ = (id) => document.getElementById(id);
  const state = { specs: [], stages: [], suites: [], options: {}, eventSource: null, watchingId: null, videoRuns: new Set(), videoRunId: null };

  // ── Data ───────────────────────────────────────────────────────────────
  async function loadProjectData() {
    const [specs, stages, suites, options] = await Promise.all([
      api('/specs'), api('/stages'), api('/step-suites'), api('/run-options'),
    ]);
    state.specs = specs.specs;
    state.stages = stages.stages;
    state.suites = suites.suites;
    state.options = options;
    if (!state.stages.some((s) => s.name === prefs.stage)) prefs.stage = stages.defaultStage || (state.stages[0] && state.stages[0].name) || '';
    if (!state.specs.some((s) => s.value === prefs.spec)) prefs.spec = '';
  }

  const currentSpec = () => state.specs.find((s) => s.value === prefs.spec) || null;
  const currentStage = () => state.stages.find((s) => s.name === prefs.stage) || null;
  const suitesForSpec = () => state.suites.filter((s) => s.spec && s.spec === prefs.spec && s.steps.length);

  // ── Spec combobox ──────────────────────────────────────────────────────
  const specInput = $('spec-input');
  const specList = $('spec-list');
  let activeIndex = -1;

  function filteredSpecs() {
    const q = specInput.value.trim().toLowerCase();
    const selected = currentSpec();
    if (!q || (selected && specInput.value === selected.label)) return state.specs;
    return state.specs.filter((s) => s.label.toLowerCase().includes(q) || s.value.toLowerCase().includes(q));
  }

  function renderSpecList() {
    const items = filteredSpecs();
    if (!state.specs.length) {
      specList.innerHTML = '<li class="combobox-empty">No specs found in cypress/e2e/.</li>';
      return;
    }
    if (!items.length) {
      specList.innerHTML = '<li class="combobox-empty">No matching spec.</li>';
      return;
    }
    let lastCategory = null;
    specList.innerHTML = items.map((s, i) => {
      const group = s.category !== lastCategory ? `<li class="combobox-group" role="presentation">${escapeHtml(s.category)}</li>` : '';
      lastCategory = s.category;
      return `${group}<li class="combobox-option ${s.wildcard ? 'wildcard' : ''} ${i === activeIndex ? 'active' : ''}" role="option" data-index="${i}">
        ${escapeHtml(s.label)}<small>${escapeHtml(s.value)}</small></li>`;
    }).join('');
  }

  function openSpecList(open) {
    specList.hidden = !open;
    specInput.setAttribute('aria-expanded', String(open));
    if (open) {
      activeIndex = -1;
      renderSpecList();
    }
  }

  function selectSpec(spec) {
    prefs.spec = spec ? spec.value : '';
    specInput.value = spec ? spec.label : '';
    $('spec-hint').textContent = spec ? spec.value : '';
    savePrefs();
    openSpecList(false);
    renderSteps();
    refreshPreview();
  }

  specInput.addEventListener('focus', () => { specInput.select(); openSpecList(true); });
  specInput.addEventListener('input', () => { activeIndex = 0; specList.hidden = false; renderSpecList(); });
  specInput.addEventListener('keydown', (e) => {
    const items = filteredSpecs();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      specList.hidden = false;
      activeIndex = Math.max(0, Math.min(items.length - 1, activeIndex + (e.key === 'ArrowDown' ? 1 : -1)));
      renderSpecList();
      const el = specList.querySelector('.combobox-option.active');
      if (el) el.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[activeIndex]) selectSpec(items[activeIndex]);
    } else if (e.key === 'Escape') {
      openSpecList(false);
      specInput.blur();
    }
  });
  specInput.addEventListener('blur', () => setTimeout(() => {
    openSpecList(false);
    const spec = currentSpec();
    specInput.value = spec ? spec.label : '';
  }, 150));
  specList.addEventListener('mousedown', (e) => {
    const option = e.target.closest('.combobox-option');
    if (option) selectSpec(filteredSpecs()[Number(option.dataset.index)]);
  });

  // ── Stage picker ───────────────────────────────────────────────────────
  const hostOf = (url) => {
    try { return new URL(url).host; } catch { return url; }
  };

  function renderStages() {
    const picker = $('stage-picker');
    if (!state.stages.length) {
      picker.innerHTML = '<span class="muted">No stages defined in cypress.env.json.</span>';
      return;
    }
    picker.innerHTML = state.stages.map((s) => `
      <button type="button" role="radio" aria-checked="${s.name === prefs.stage}" class="stage-option ${s.name === prefs.stage ? 'active' : ''} ${s.protected ? 'protected' : ''}"
        data-stage="${escapeHtml(s.name)}" title="${escapeHtml(s.baseUrl || '')}">
        <strong>${escapeHtml(s.description)}</strong><span>${escapeHtml(s.baseUrl ? hostOf(s.baseUrl) : s.name)}</span>
      </button>`).join('');
  }
  $('stage-picker').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-stage]');
    if (!btn) return;
    prefs.stage = btn.dataset.stage;
    savePrefs();
    renderStages();
    refreshPreview();
  });

  // ── Step selection ─────────────────────────────────────────────────────
  function renderSteps() {
    const suites = suitesForSpec();
    $('steps-field').hidden = !suites.length;
    $('step-suites').innerHTML = suites.map((suite) => {
      const saved = prefs.cutoffs[suite.suite];
      const cutoff = suite.steps.some((s) => s.key === saved) ? saved : suite.steps[suite.steps.length - 1].key;
      const cutoffIdx = suite.steps.findIndex((s) => s.key === cutoff);
      const full = cutoffIdx === suite.steps.length - 1;
      return `
        <div class="step-suite" data-suite="${escapeHtml(suite.suite)}">
          <h4><span>${escapeHtml(suite.label)}</span><span class="badge ${full ? 'badge-brand' : ''}">${full ? 'Full run' : `${cutoffIdx + 1} of ${suite.steps.length} steps`}</span></h4>
          <ol class="step-list">
            ${suite.steps.map((s, i) => `
              <li data-key="${escapeHtml(s.key)}" class="${i <= cutoffIdx ? 'included' : ''} ${i === cutoffIdx ? 'cutoff' : ''}" title="Run up to this step">
                <span class="step-num">${i + 1}</span><span>${escapeHtml(s.label)}</span>
              </li>`).join('')}
          </ol>
        </div>`;
    }).join('');
  }
  $('step-suites').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-key]');
    if (!li) return;
    prefs.cutoffs[li.closest('[data-suite]').dataset.suite] = li.dataset.key;
    savePrefs();
    renderSteps();
    refreshPreview();
  });

  function stepCutoffs() {
    const out = {};
    suitesForSpec().forEach((suite) => {
      const key = prefs.cutoffs[suite.suite];
      const last = suite.steps[suite.steps.length - 1].key;
      if (key && key !== last && suite.steps.some((s) => s.key === key)) out[suite.suite] = key;
    });
    return out;
  }

  // ── Run options ────────────────────────────────────────────────────────
  function renderOptions() {
    $('browser').innerHTML = state.options.browsers.map((b) => `<option value="${b}" ${b === prefs.browser ? 'selected' : ''}>${b[0].toUpperCase()}${b.slice(1)}</option>`).join('');
    $('parallel').max = state.options.maxParallelRuns;
    $('parallel').value = prefs.parallel;
    $('headed').checked = prefs.headed;
    $('record-video').checked = prefs.recordVideo;
    if (!state.options.liveViewAvailable) {
      $('headed-hint').textContent = 'Opens the browser on this machine (no live view stream available here).';
    }
    document.querySelectorAll('#speed button').forEach((b) => b.classList.toggle('active', Number(b.dataset.delay) === prefs.delay));
    syncParallelLock();
  }

  // Live view and parallel runs exclude each other.
  function syncParallelLock() {
    $('parallel').disabled = prefs.headed;
    $('headed').disabled = prefs.parallel > 1;
  }

  $('browser').addEventListener('change', (e) => { prefs.browser = e.target.value; savePrefs(); refreshPreview(); });
  $('parallel').addEventListener('input', (e) => {
    prefs.parallel = Math.min(state.options.maxParallelRuns, Math.max(1, parseInt(e.target.value, 10) || 1));
    savePrefs();
    syncParallelLock();
  });
  $('headed').addEventListener('change', (e) => { prefs.headed = e.target.checked; savePrefs(); syncParallelLock(); refreshPreview(); });
  $('record-video').addEventListener('change', (e) => { prefs.recordVideo = e.target.checked; savePrefs(); refreshPreview(); });
  $('speed').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-delay]');
    if (!btn) return;
    prefs.delay = Number(btn.dataset.delay);
    savePrefs();
    renderOptions();
    refreshPreview();
  });

  function runRequest() {
    return {
      spec: prefs.spec,
      stage: prefs.stage,
      browser: prefs.browser,
      headed: prefs.headed,
      recordVideo: prefs.recordVideo,
      delay: prefs.delay,
      parallel: prefs.headed ? 1 : prefs.parallel,
      stepCutoffs: stepCutoffs(),
    };
  }

  const refreshPreview = debounce(async () => {
    $('run-btn').disabled = !prefs.spec || !prefs.stage;
    if (!prefs.spec) {
      $('command-preview').textContent = 'Select a test to see the command.';
      return;
    }
    try {
      $('command-preview').textContent = (await api('/runs/preview', { method: 'POST', body: runRequest() })).command;
    } catch (err) {
      $('command-preview').textContent = err.message;
    }
  }, 150);

  // ── Starting a run ─────────────────────────────────────────────────────
  async function startRun() {
    const btn = $('run-btn');
    const body = runRequest();
    const stage = currentStage();
    if (stage && stage.protected) {
      const ok = await confirmDialog(`"${stage.description}" is a protected environment. Tests may change data there. Run anyway?`, {
        title: 'Run against a protected environment', confirmLabel: 'Run on ' + stage.description, danger: true,
      });
      if (!ok) return;
      body.confirmProtected = true;
    }

    btn.disabled = true;
    $('run-btn-label').innerHTML = '<span class="spinner"></span> Starting…';
    try {
      const data = await api('/runs', { method: 'POST', body });
      if (body.recordVideo) data.runs.forEach((r) => state.videoRuns.add(r.processId));
      writePref(LAST_RUN_KEY, data.processId);
      toast(data.parallel > 1
        ? `${data.parallel} runs scheduled, starting ${Math.round(data.startDelayMs / 1000)}s apart. Output shows run #${data.processId}.`
        : `Run #${data.processId} started`, 'success');
      if (data.vnc) openLiveView(data.vnc, data.processId);
      watch(data.processId);
      refreshProcesses();
    } catch (err) {
      toast(err.message, 'error', 7000);
    } finally {
      btn.disabled = false;
      $('run-btn-label').textContent = 'Start run';
    }
  }
  $('run-btn').addEventListener('click', startRun);

  function openLiveView(vnc, processId) {
    const fbW = (vnc.screen && vnc.screen.width) || 1920;
    const fbH = (vnc.screen && vnc.screen.height) || 1080;
    const availW = window.screen.availWidth || 1440;
    const availH = window.screen.availHeight || 900;
    const scale = Math.min((availW * 0.92) / fbW, (availH * 0.88) / fbH, 1);
    const width = Math.max(640, Math.round(fbW * scale));
    const height = Math.max(400, Math.round(fbH * scale));
    const left = Math.round((window.screen.availLeft || 0) + (availW - width) / 2);
    const top = Math.round((window.screen.availTop || 0) + (availH - height) / 2);
    const win = window.open(vnc.url, `vnc_${processId}`, `popup=1,width=${width},height=${height},left=${left},top=${top}`);
    if (!win) return toast('The live view window was blocked — allow pop-ups for this site.', 'warning', 7000);
    try {
      win.resizeTo(width, height);
      win.moveTo(left, top);
      win.focus();
    } catch { /* opened as tab */ }
  }

  // ── Output stream ──────────────────────────────────────────────────────
  const terminal = $('terminal');

  function setOutputStatus(kind, label) {
    const cls = { running: 'badge-brand', passed: 'badge-success', failed: 'badge-danger' }[kind] || '';
    $('output-status').innerHTML = label
      ? `<span class="badge ${cls}">${kind === 'running' ? '<span class="dot dot-pulse"></span>' : ''}${escapeHtml(label)}</span>` : '';
  }

  function appendOutput(text, isError) {
    const placeholder = terminal.querySelector('.placeholder');
    if (placeholder) placeholder.remove();
    const nearBottom = terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 60;
    const span = document.createElement('span');
    if (isError) span.className = 'line-err';
    span.innerHTML = escapeHtml(text).replace(/(https?:\/\/[^\s<>"']+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    terminal.appendChild(span);
    if (nearBottom) terminal.scrollTop = terminal.scrollHeight;
  }

  function watch(processId) {
    if (state.eventSource) state.eventSource.close();
    state.watchingId = processId;
    terminal.innerHTML = '';
    setOutputStatus('running', `Run #${processId}`);
    highlightWatched();

    const es = new EventSource(`/api/processes/${processId}/stream`);
    state.eventSource = es;
    es.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'output' || msg.type === 'error') {
        appendOutput(msg.data, msg.type === 'error');
      } else if (msg.type === 'complete') {
        es.close();
        state.eventSource = null;
        setOutputStatus(msg.success ? 'passed' : 'failed', `#${processId} · ${msg.resultLabel || (msg.success ? 'Passed' : 'Failed')}`);
        refreshProcesses();
        if (state.videoRuns.has(processId)) {
          state.videoRuns.delete(processId);
          loadVideos(processId);
        }
      }
    };
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) setOutputStatus('failed', `#${processId} · connection lost`);
    };
  }

  $('clear-output').addEventListener('click', () => {
    if (state.eventSource) state.eventSource.close();
    state.eventSource = null;
    state.watchingId = null;
    terminal.innerHTML = '<span class="placeholder">Output cleared.</span>';
    setOutputStatus();
    writePref(LAST_RUN_KEY, null);
    highlightWatched();
  });

  // ── Process list ───────────────────────────────────────────────────────
  const specLabel = (value) => {
    const spec = state.specs.find((s) => s.value === value);
    return spec ? spec.label : value;
  };
  const stageLabel = (name) => {
    const stage = state.stages.find((s) => s.name === name);
    return stage ? stage.description : name;
  };

  function processRow(p) {
    const meta = [
      `<span class="badge">${escapeHtml(stageLabel(p.sut))}</span>`,
      p.headed ? '<span class="badge badge-brand">Live view</span>' : '',
      p.batch ? `<span class="badge">Parallel ${p.batch.index}/${p.batch.size}</span>` : '',
      p.mine ? '' : `<span>by ${escapeHtml(p.username)}</span>`,
      p.pending ? `<span>starts in ${Math.ceil(p.startsInMs / 1000)}s</span>` : `<span>${formatDuration(p.durationMs)}</span>`,
      `<span class="faint">#${p.id}</span>`,
    ].filter(Boolean).join('');
    return `
      <div class="process ${p.id === state.watchingId ? 'watching' : ''}" data-id="${p.id}">
        <span class="badge ${p.pending ? '' : 'badge-brand'}"><span class="dot ${p.pending ? '' : 'dot-pulse'}"></span>${p.pending ? 'Scheduled' : 'Running'}</span>
        <div class="process-main"><strong title="${escapeHtml(p.spec)}">${escapeHtml(specLabel(p.spec))}</strong><div class="process-meta">${meta}</div></div>
        <div class="process-actions">
          ${p.pending ? '' : '<button class="btn btn-sm" data-action="watch" type="button">Output</button>'}
          <button class="btn btn-sm btn-danger" data-action="kill" type="button">${p.pending ? 'Cancel' : 'Stop'}</button>
        </div>
      </div>`;
  }

  async function refreshProcesses() {
    try {
      const { processes, limit } = await api('/processes');
      $('quota').textContent = `${limit.used}/${limit.perUser} sessions`;
      $('quota').className = `badge ${limit.used >= limit.perUser ? 'badge-danger' : ''}`;
      const mine = processes.filter((p) => p.mine);
      const others = processes.filter((p) => !p.mine);
      const list = $('process-list');
      if (!processes.length) {
        list.innerHTML = '<div class="empty"><strong>No active runs</strong>Started runs show up here.</div>';
        return;
      }
      list.innerHTML = mine.map(processRow).join('')
        + (others.length ? `<div class="process-section">Other users</div>${others.map(processRow).join('')}` : '');
    } catch { /* retried on next poll */ }
  }

  function highlightWatched() {
    document.querySelectorAll('.process').forEach((el) => el.classList.toggle('watching', Number(el.dataset.id) === state.watchingId));
  }

  $('process-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = Number(btn.closest('[data-id]').dataset.id);
    if (btn.dataset.action === 'watch') return watch(id);
    if (!(await confirmDialog(`Stop run #${id}?`, { confirmLabel: 'Stop run', danger: true }))) return;
    try {
      await api(`/processes/${id}/kill`, { method: 'POST' });
      toast(`Run #${id} stopped`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
    refreshProcesses();
  });

  // ── Recordings ─────────────────────────────────────────────────────────
  async function loadVideos(processId) {
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const { videos } = await api(`/processes/${processId}/videos`);
        if (videos.length) return renderVideos(processId, videos);
      } catch { /* not ready yet */ }
      await new Promise((r) => setTimeout(r, 750));
    }
    toast('No recording found for this run.', 'warning');
  }

  function renderVideos(processId, videos) {
    state.videoRunId = processId;
    $('video-list').innerHTML = '';
    videos.forEach((v) => {
      const src = `/api/processes/${processId}/videos/${encodeURIComponent(v.file)}`;
      const item = html(`
        <div class="video-item">
          <video class="test-video" controls src="${src}"></video>
          <div class="form-row"><span class="mono muted">${escapeHtml(v.file)}</span><a class="btn btn-sm" href="${src}" download="${escapeHtml(v.file)}">Download</a></div>
        </div>`);
      item.querySelector('a').addEventListener('click', () => {
        api(`/processes/${processId}/videos/${encodeURIComponent(v.file)}/downloaded`, { method: 'POST' }).catch(() => {});
      });
      $('video-list').appendChild(item);
    });
    $('video-card').hidden = false;
  }

  function hideVideos() {
    $('video-list').querySelectorAll('video').forEach((v) => { v.pause(); v.removeAttribute('src'); });
    $('video-list').innerHTML = '';
    $('video-card').hidden = true;
    state.videoRunId = null;
  }

  $('hide-video').addEventListener('click', hideVideos);
  $('delete-video').addEventListener('click', async () => {
    if (!state.videoRunId) return;
    if (!(await confirmDialog('Delete this recording? Files that were not downloaded are lost.', { confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api(`/processes/${state.videoRunId}`, { method: 'DELETE' });
      hideVideos();
      toast('Recording deleted', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Reattach to the last run started in this browser after navigating away and back.
  async function restoreLastRun() {
    const lastId = readPref(LAST_RUN_KEY, null);
    if (!lastId) return;
    try {
      const info = await api(`/processes/${lastId}`);
      watch(lastId);
      if (!info.isRunning && info.videos && info.videos.length) renderVideos(lastId, info.videos);
    } catch {
      writePref(LAST_RUN_KEY, null);
    }
  }

  // ── Init ───────────────────────────────────────────────────────────────
  try {
    await loadProjectData();
  } catch (err) {
    toast(err.message, 'error', 10000);
  }
  renderStages();
  if (state.options.browsers) renderOptions();
  selectSpec(currentSpec());
  refreshProcesses();
  restoreLastRun();
  setInterval(refreshProcesses, 3000);
})();
