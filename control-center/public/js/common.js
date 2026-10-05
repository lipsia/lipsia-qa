// Shared helpers for all Control Center pages.
(function () {
  const THEME_KEY = 'cc-theme';

  const ICONS = {
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  };

  const NAV = [
    { href: '/', label: 'Test Runner', key: 'runner' },
    { href: '/coverage', label: 'Coverage', key: 'coverage' },
    { href: '/dashboard', label: 'Dashboard', key: 'dashboard', admin: true },
    { href: '/users', label: 'Users', key: 'users', admin: true },
  ];

  // ── Theme ───────────────────────────────────────────────────────────────
  function storedTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch { return null; }
  }
  function effectiveTheme() {
    return document.documentElement.dataset.theme
      || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  function applyTheme(theme) {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      btn.innerHTML = effectiveTheme() === 'dark' ? ICONS.sun : ICONS.moon;
    });
  }
  function toggleTheme() {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch { /* storage unavailable */ }
    applyTheme(next);
  }
  applyTheme(storedTheme());

  // ── DOM helpers ─────────────────────────────────────────────────────────
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function html(markup) {
    const tpl = document.createElement('template');
    tpl.innerHTML = markup.trim();
    return tpl.content.firstElementChild;
  }

  // ── API ─────────────────────────────────────────────────────────────────
  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(`/api${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && !path.startsWith('/auth/')) {
      location.href = '/login';
      throw new Error('Session expired');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ── Toasts ──────────────────────────────────────────────────────────────
  function toast(message, type = 'info', timeoutMs = 4500) {
    let container = document.querySelector('.toasts');
    if (!container) {
      container = html('<div class="toasts" role="status" aria-live="polite"></div>');
      document.body.appendChild(container);
    }
    const node = html(`<div class="toast ${type}"><div>${escapeHtml(message)}</div></div>`);
    container.appendChild(node);
    setTimeout(() => node.remove(), timeoutMs);
  }

  // ── Modals ──────────────────────────────────────────────────────────────
  /**
   * Opens a modal. `body` is an HTML string or node; `actions` are buttons
   * `{ label, variant, onClick(close) }` rendered in the footer.
   */
  function openModal({ title, body, actions = [], wide = false, onClose }) {
    const backdrop = html(`
      <div class="modal-backdrop">
        <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
          <div class="modal-head"><h3>${escapeHtml(title)}</h3><button class="icon-btn" data-close aria-label="Close">${ICONS.close}</button></div>
          <div class="modal-body"></div>
          ${actions.length ? '<div class="modal-foot"></div>' : ''}
        </div>
      </div>`);
    const bodyEl = backdrop.querySelector('.modal-body');
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);

    const close = () => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      if (onClose) onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('[data-close]').addEventListener('click', close);

    const foot = backdrop.querySelector('.modal-foot');
    actions.forEach((a) => {
      const btn = html(`<button class="btn ${a.variant ? `btn-${a.variant}` : ''}" type="button">${escapeHtml(a.label)}</button>`);
      btn.addEventListener('click', () => (a.onClick ? a.onClick(close, btn) : close()));
      foot.appendChild(btn);
    });

    document.body.appendChild(backdrop);
    const focusable = backdrop.querySelector('input, select, textarea, .modal-foot .btn-primary, .modal-foot .btn-danger');
    if (focusable) focusable.focus();
    return { close, element: backdrop, body: bodyEl };
  }

  function confirmDialog(message, { title = 'Please confirm', confirmLabel = 'Confirm', danger = false } = {}) {
    return new Promise((resolve) => {
      let answered = false;
      openModal({
        title,
        body: `<p style="margin:0">${escapeHtml(message)}</p>`,
        onClose: () => { if (!answered) resolve(false); },
        actions: [
          { label: 'Cancel' },
          { label: confirmLabel, variant: danger ? 'danger' : 'brand', onClick: (close) => { answered = true; close(); resolve(true); } },
        ],
      });
    });
  }

  function changePasswordDialog(username, { self = true } = {}) {
    const modal = openModal({
      title: self ? 'Change your password' : `Reset password for ${username}`,
      body: `
        <form class="stack" style="gap:14px" autocomplete="off">
          <div class="field"><label for="pw-new">New password</label><input class="input" id="pw-new" type="password" autocomplete="new-password" minlength="8" required></div>
          <div class="field"><label for="pw-confirm">Confirm password</label><input class="input" id="pw-confirm" type="password" autocomplete="new-password" required></div>
          <span class="field-hint">At least 8 characters.</span>
        </form>`,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Save password',
          variant: 'brand',
          onClick: async (close) => {
            const pw = modal.body.querySelector('#pw-new').value;
            if (pw !== modal.body.querySelector('#pw-confirm').value) return toast('Passwords do not match', 'error');
            try {
              await api(`/users/${encodeURIComponent(username)}/password`, { method: 'POST', body: { password: pw } });
              toast('Password updated', 'success');
              close();
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        },
      ],
    });
  }

  // ── App shell ───────────────────────────────────────────────────────────
  async function logout() {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    location.href = '/login';
  }

  function renderHeader(user, active) {
    const nav = NAV.filter((n) => !n.admin || user.role === 'admin')
      .map((n) => `<a href="${n.href}" class="${n.key === active ? 'active' : ''}">${n.label}</a>`).join('');
    const header = html(`
      <header class="app-header">
        <div class="app-header-inner">
          <a class="brand" href="/" aria-label="Lipsia Digital QA Control Center">
            <img src="/assets/logo-white.svg" alt="Lipsia Digital">
            <span class="brand-product">QA Control Center</span>
          </a>
          <nav class="app-nav">${nav}</nav>
          <div class="header-actions">
            <button class="icon-btn" data-theme-toggle title="Toggle light / dark mode" aria-label="Toggle theme"></button>
            <div class="user-menu">
              <button class="user-chip" aria-haspopup="menu">
                <span class="avatar">${escapeHtml(user.username.slice(0, 2))}</span>
                <span class="user-name">${escapeHtml(user.username)}</span>
              </button>
              <div class="dropdown" role="menu" hidden>
                <div class="dropdown-head"><strong>${escapeHtml(user.username)}</strong><div class="muted" style="font-size:12px">${user.role === 'admin' ? 'Administrator' : 'User'}</div></div>
                <button data-action="password" role="menuitem">Change password</button>
                <button data-action="logout" role="menuitem">Sign out</button>
              </div>
            </div>
          </div>
        </div>
      </header>`);

    header.querySelector('[data-theme-toggle]').addEventListener('click', toggleTheme);
    const dropdown = header.querySelector('.dropdown');
    header.querySelector('.user-chip').addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.hidden = !dropdown.hidden;
    });
    document.addEventListener('click', () => { dropdown.hidden = true; });
    dropdown.querySelector('[data-action="password"]').addEventListener('click', () => changePasswordDialog(user.username));
    dropdown.querySelector('[data-action="logout"]').addEventListener('click', logout);

    document.body.prepend(header);
    applyTheme(storedTheme());
  }

  /** Loads the session user and renders the header. Redirects to /login without a session. */
  async function initShell(active) {
    let user;
    try {
      user = await api('/auth/me');
    } catch (err) {
      location.href = '/login';
      throw err;
    }
    renderHeader(user, active);
    return user;
  }

  // ── Formatting ──────────────────────────────────────────────────────────
  function formatDuration(ms) {
    const total = Math.round((ms || 0) / 1000);
    if (total < 60) return `${total}s`;
    const m = Math.floor(total / 60);
    if (m < 60) return `${m}m ${String(total % 60).padStart(2, '0')}s`;
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
  }

  function formatDateTime(iso) {
    if (!iso) return '–';
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function readPref(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  }

  function writePref(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  }

  window.CC = {
    ICONS,
    api,
    html,
    escapeHtml,
    toast,
    openModal,
    confirmDialog,
    changePasswordDialog,
    initShell,
    formatDuration,
    formatDateTime,
    debounce,
    readPref,
    writePref,
  };
})();
