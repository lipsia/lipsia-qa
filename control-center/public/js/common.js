// Shared helpers for all Control Center pages.
(function () {
  const THEME_KEY = 'cc-theme';
  const USER_KEY = 'cc-user';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

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
    const root = document.documentElement;
    if (theme) root.dataset.theme = theme;
    else delete root.dataset.theme;
    root.classList.toggle('is-dark', effectiveTheme() === 'dark');
  }

  // Animated switch: a circle grows from the toggle where View Transitions exist, else colours fade.
  let themeFadeTimer;
  function toggleTheme(event) {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch { /* storage unavailable */ }
    const root = document.documentElement;

    if (reduceMotion.matches) return applyTheme(next);
    if (!document.startViewTransition) {
      root.classList.add('theme-fade');
      applyTheme(next);
      clearTimeout(themeFadeTimer);
      themeFadeTimer = setTimeout(() => root.classList.remove('theme-fade'), 500);
      return;
    }

    const transition = document.startViewTransition(() => {
      root.classList.add('theme-switching');
      applyTheme(next);
    });
    transition.finished.catch(() => {}).finally(() => root.classList.remove('theme-switching'));

    const r = event.currentTarget.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    transition.ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 700, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    }).catch(() => {});
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
    setTimeout(() => leave(node, 'leaving'), timeoutMs);
  }

  // Plays the element's exit animation (CSS class), then removes it.
  function leave(node, className) {
    if (reduceMotion.matches) return node.remove();
    node.classList.add(className);
    node.addEventListener('animationend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 600);
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
      leave(backdrop, 'closing');
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
    try { sessionStorage.removeItem(USER_KEY); } catch { /* storage unavailable */ }
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
            <button class="icon-btn theme-toggle" data-theme-toggle title="Toggle light / dark mode" aria-label="Toggle theme">
              ${ICONS.moon.replace('<svg', '<svg class="moon"')}${ICONS.sun.replace('<svg', '<svg class="sun"')}
            </button>
            <div class="user-menu">
              <button class="user-chip" aria-haspopup="menu">
                <span class="avatar">${escapeHtml(user.username.slice(0, 2))}</span>
                <span class="user-name">${escapeHtml(user.username)}</span>
              </button>
              <div class="dropdown" role="menu">
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
      dropdown.classList.toggle('open');
    });
    document.addEventListener('click', () => dropdown.classList.remove('open'));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') dropdown.classList.remove('open'); });
    dropdown.querySelector('[data-action="password"]').addEventListener('click', () => changePasswordDialog(user.username));
    dropdown.querySelector('[data-action="logout"]').addEventListener('click', logout);

    const existing = document.querySelector('.app-header');
    if (existing) existing.replaceWith(header); else document.body.prepend(header);
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 4);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  function animatePageHead() {
    const h1 = document.querySelector('.page-head h1');
    if (h1 && !h1.querySelector('.rise')) h1.innerHTML = `<span class="rise">${h1.innerHTML}</span>`;
  }

  /**
   * Renders the header and verifies the session. The header is drawn immediately from the
   * cached user so page transitions don't flash; /login is loaded when there is no session.
   */
  async function initShell(active) {
    animatePageHead();
    reveal();
    let cached = null;
    try { cached = JSON.parse(sessionStorage.getItem(USER_KEY) || 'null'); } catch { /* ignore */ }
    if (cached) renderHeader(cached, active);

    let user;
    try {
      user = await api('/auth/me');
    } catch (err) {
      location.href = '/login';
      throw err;
    }
    try { sessionStorage.setItem(USER_KEY, JSON.stringify(user)); } catch { /* storage unavailable */ }
    if (!cached || cached.username !== user.username || cached.role !== user.role) renderHeader(user, active);
    document.querySelectorAll('.segmented').forEach(segmented);
    return user;
  }

  // ── Motion ──────────────────────────────────────────────────────────────
  const REVEAL_SELECTOR = '.page > section, .runner-grid > .card, .runner-grid > .stack > .card, .kpis > .card, .dash-grid > .card, #groups > .card';
  let revealObserver = null;

  /** Fades elements up as they enter the viewport, staggered by their order. */
  function reveal(root = document, selector = REVEAL_SELECTOR) {
    const els = [...root.querySelectorAll(selector)].filter((el) => !el.classList.contains('reveal'));
    if (!els.length || reduceMotion.matches || !('IntersectionObserver' in window)) return;
    if (!revealObserver) {
      revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-in');
          revealObserver.unobserve(entry.target);
        });
      }, { rootMargin: '0px 0px -6% 0px' });
    }
    els.forEach((el, i) => {
      el.style.setProperty('--reveal-delay', `${Math.min(i, 6) * 70}ms`);
      el.classList.add('reveal');
    });
    // Commit the hidden start state, otherwise elements already in view would skip the transition.
    void document.body.offsetWidth;
    els.forEach((el) => revealObserver.observe(el));
  }

  /** Staggered entry animation for freshly rendered children (rows, list items). */
  function stagger(elements) {
    if (reduceMotion.matches) return;
    [...elements].forEach((el, i) => {
      el.style.setProperty('--i', i);
      el.classList.add('anim-in');
    });
  }

  /** Counts a number up from 0 to `to`. `format` turns the current value into text. */
  function countUp(el, to, { duration = 900, format = (v) => Math.round(v).toLocaleString() } = {}) {
    if (reduceMotion.matches || !Number.isFinite(to)) {
      el.textContent = format(to);
      return;
    }
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      el.textContent = format(to * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /**
   * Adds a sliding marker to a `.segmented` control. It follows whichever button carries
   * `.active`, so callers only toggle that class.
   */
  function segmented(container) {
    if (container.querySelector('.segmented-thumb')) return;
    const thumb = html('<span class="segmented-thumb" aria-hidden="true"></span>');
    container.prepend(thumb);
    let first = true;
    const place = () => {
      const active = container.querySelector('button.active');
      thumb.style.opacity = active ? '1' : '0';
      if (!active) return;
      if (first || reduceMotion.matches) thumb.classList.add('no-anim');
      thumb.style.width = `${active.offsetWidth}px`;
      thumb.style.transform = `translateX(${active.offsetLeft}px)`;
      if (first) requestAnimationFrame(() => thumb.classList.remove('no-anim'));
      first = false;
    };
    new MutationObserver(place).observe(container, { subtree: true, attributes: true, attributeFilter: ['class'] });
    new ResizeObserver(place).observe(container);
    place();
  }

  /** Restarts a one-shot CSS animation class on an element. */
  function replay(el, className) {
    if (!el || reduceMotion.matches) return;
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
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
    reveal,
    stagger,
    segmented,
    countUp,
    replay,
    reduceMotion,
    formatDuration,
    formatDateTime,
    debounce,
    readPref,
    writePref,
  };
})();
