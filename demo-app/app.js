// Sunline CRM: a fictional, self-contained demo app for showing E2E tests in the E2E Hub.
// All data lives in localStorage, so every Cypress run starts from the same seed data.
(function () {
  const STORE_KEY = 'sunline-demo';
  const USERS = { demo: 'demo' };
  const PRICE_PER_KWP = 1450;
  const BATTERY_PRICE = 4900;
  const STATUS_LABELS = { new: 'New', appointment: 'Appointment', offer: 'Offer sent', won: 'Won', lost: 'Lost' };

  const SEED = {
    nextId: 5,
    session: null,
    leads: [
      { id: 1, name: 'Martina Keller', email: 'm.keller@example.com', phone: '0341 555 0101', zip: '04109', city: 'Leipzig', product: 'pv', status: 'won', createdAt: '2026-09-02T09:15:00Z', history: [] },
      { id: 2, name: 'Jonas Brandt', email: 'jonas.brandt@example.com', phone: '0351 555 0144', zip: '01067', city: 'Dresden', product: 'pv-battery', status: 'offer', offer: { kwp: 10, battery: true, total: 19400 }, createdAt: '2026-09-18T13:40:00Z', history: [] },
      { id: 3, name: 'Aylin Demir', email: 'aylin.demir@example.com', phone: '0345 555 0177', zip: '06108', city: 'Halle', product: 'battery', status: 'appointment', createdAt: '2026-09-27T08:05:00Z', history: [] },
      { id: 4, name: 'Peter Wolff', email: 'p.wolff@example.com', phone: '0361 555 0123', zip: '99084', city: 'Erfurt', product: 'pv', status: 'new', createdAt: '2026-10-01T16:20:00Z', history: [] },
    ],
  };
  const PRODUCTS = { pv: 'Solar system', 'pv-battery': 'Solar system + battery', battery: 'Battery retrofit' };

  // ── Store ───────────────────────────────────────────────────────────────
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* fall back to seed */ }
    return JSON.parse(JSON.stringify(SEED));
  }
  let state = load();
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
  }
  function resetData() {
    const session = state.session;
    state = JSON.parse(JSON.stringify(SEED));
    state.session = session;
    save();
  }
  const findLead = (id) => state.leads.find((l) => l.id === Number(id));
  function addHistory(lead, text) {
    lead.history.unshift({ at: new Date().toISOString(), text });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────
  const app = document.getElementById('app');
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const euro = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
  const date = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const dateTime = (iso) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const statusBadge = (s) => `<span class="status status-${s}" data-testid="lead-status">${STATUS_LABELS[s]}</span>`;

  function toast(text) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.dataset.testid = 'toast';
    el.textContent = text;
    document.getElementById('toasts').append(el);
    setTimeout(() => el.remove(), 3500);
  }

  function go(hash) { location.hash = hash; }

  /** Offer price. WELCOME50 is meant to take 50 € off; the 50 % below is the app's planted bug. */
  function calcOffer({ kwp, battery, code }) {
    const subtotal = Math.round(kwp * PRICE_PER_KWP) + (battery ? BATTERY_PRICE : 0);
    let discount = 0;
    const normalized = String(code || '').trim().toUpperCase();
    if (normalized === 'SUN10') discount = Math.round(subtotal * 0.1);
    if (normalized === 'WELCOME50') discount = Math.round(subtotal * 0.5);
    const valid = !normalized || normalized === 'SUN10' || normalized === 'WELCOME50';
    return { subtotal, discount, total: subtotal - discount, valid };
  }

  // ── Layout ──────────────────────────────────────────────────────────────
  function shell(active, content) {
    app.innerHTML = `
      <header class="topbar">
        <div class="topbar-inner">
          <a class="logo" href="#/leads"><span class="logo-mark"></span>Sunline CRM <small>Demo</small></a>
          <nav class="topnav">
            <a href="#/leads" class="${active === 'leads' ? 'active' : ''}" data-testid="nav-leads">Leads</a>
            <a href="#/leads/new" class="${active === 'new' ? 'active' : ''}" data-testid="nav-new-lead">New lead</a>
          </nav>
          <div class="user">
            <span data-testid="current-user">Signed in as <strong>${esc(state.session)}</strong></span>
            <button class="btn" data-testid="logout" type="button">Sign out</button>
          </div>
        </div>
      </header>
      <main>${content}</main>
      <footer class="footer">
        <span>Fictional demo application for E2E test presentations. No real data.</span>
        <button class="link-btn" data-testid="reset-data" type="button">Reset demo data</button>
      </footer>`;
    app.querySelector('[data-testid="logout"]').addEventListener('click', () => {
      state.session = null;
      save();
      go('#/login');
    });
    app.querySelector('[data-testid="reset-data"]').addEventListener('click', () => {
      resetData();
      toast('Demo data reset');
      route();
    });
  }

  // ── Pages ───────────────────────────────────────────────────────────────
  function loginPage() {
    app.innerHTML = `
      <div class="login">
        <div class="card">
          <div class="logo"><span class="logo-mark"></span>Sunline CRM <small>Demo</small></div>
          <form data-testid="login-form" novalidate>
            <div class="alert" data-testid="login-error" hidden>Invalid username or password.</div>
            <div class="field"><label for="username">Username</label><input class="input" id="username" name="username" data-testid="login-username" autocomplete="username"></div>
            <div class="field"><label for="password">Password</label><input class="input" id="password" name="password" type="password" data-testid="login-password" autocomplete="current-password"></div>
            <button class="btn btn-primary" data-testid="login-submit" type="submit">Sign in</button>
          </form>
          <p class="hint">Demo access: <strong>demo</strong> / <strong>demo</strong></p>
        </div>
      </div>`;
    const form = app.querySelector('form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const username = form.username.value.trim();
      if (USERS[username] && USERS[username] === form.password.value) {
        state.session = username;
        save();
        go('#/leads');
      } else {
        form.querySelector('[data-testid="login-error"]').hidden = false;
      }
    });
  }

  function leadsPage() {
    const counts = Object.keys(STATUS_LABELS).reduce((acc, s) => ({ ...acc, [s]: state.leads.filter((l) => l.status === s).length }), {});
    shell('leads', `
      <div class="page-head">
        <div><h1>Leads</h1><p>All enquiries from the website and sales partners.</p></div>
        <a class="btn btn-primary" href="#/leads/new" data-testid="new-lead">+ New lead</a>
      </div>
      <div class="kpis">
        <div class="kpi"><span>Total</span><strong data-testid="kpi-total">${state.leads.length}</strong></div>
        <div class="kpi"><span>New</span><strong data-testid="kpi-new">${counts.new}</strong></div>
        <div class="kpi"><span>Offers sent</span><strong data-testid="kpi-offer">${counts.offer}</strong></div>
        <div class="kpi"><span>Won</span><strong data-testid="kpi-won">${counts.won}</strong></div>
      </div>
      <div class="card">
        <div class="toolbar">
          <input class="input" type="search" placeholder="Search name, email or city" data-testid="lead-search">
          <select class="input" style="max-width:180px" data-testid="status-filter">
            <option value="">All statuses</option>
            ${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
          </select>
        </div>
        <table class="table" data-testid="lead-table">
          <thead><tr><th>Name</th><th>City</th><th>Product</th><th>Status</th><th>Created</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>`);
    const search = app.querySelector('[data-testid="lead-search"]');
    const filter = app.querySelector('[data-testid="status-filter"]');
    const tbody = app.querySelector('tbody');
    const render = () => {
      const q = search.value.trim().toLowerCase();
      const rows = state.leads
        .filter((l) => !filter.value || l.status === filter.value)
        .filter((l) => !q || [l.name, l.email, l.city].some((v) => v.toLowerCase().includes(q)))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      tbody.innerHTML = rows.map((l) => `
        <tr data-testid="lead-row" data-id="${l.id}">
          <td><strong>${esc(l.name)}</strong><br><span style="color:var(--muted);font-size:13px">${esc(l.email)}</span></td>
          <td>${esc(l.city)}</td>
          <td>${PRODUCTS[l.product]}</td>
          <td>${statusBadge(l.status)}</td>
          <td>${date(l.createdAt)}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="empty" data-testid="no-results">No leads match your search.</td></tr>';
    };
    search.addEventListener('input', render);
    filter.addEventListener('change', render);
    tbody.addEventListener('click', (e) => {
      const row = e.target.closest('[data-id]');
      if (row) go(`#/leads/${row.dataset.id}`);
    });
    render();
  }

  function newLeadPage() {
    shell('new', `
      <div class="page-head"><div><h1>New lead</h1><p>Capture a new enquiry.</p></div></div>
      <form class="card" data-testid="lead-form" novalidate>
        <div class="form-grid">
          <div class="field span-2"><label for="name">Full name</label><input class="input" id="name" name="name" data-testid="lead-name"></div>
          <div class="field"><label for="email">Email</label><input class="input" id="email" name="email" type="email" data-testid="lead-email"></div>
          <div class="field"><label for="phone">Phone</label><input class="input" id="phone" name="phone" data-testid="lead-phone"></div>
          <div class="field"><label for="zip">Postcode</label><input class="input" id="zip" name="zip" maxlength="5" data-testid="lead-zip"></div>
          <div class="field"><label for="city">City</label><input class="input" id="city" name="city" data-testid="lead-city"></div>
          <div class="field span-2"><label for="product">Product interest</label>
            <select class="input" id="product" name="product" data-testid="lead-product">
              ${Object.entries(PRODUCTS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
            </select>
          </div>
          <label class="checkbox span-2"><input type="checkbox" name="consent" data-testid="lead-consent"> Customer agreed to be contacted</label>
        </div>
        <div class="field-error" data-testid="form-error" hidden></div>
        <div class="form-actions">
          <a class="btn" href="#/leads">Cancel</a>
          <button class="btn btn-primary" type="submit" data-testid="lead-save">Save lead</button>
        </div>
      </form>`);
    const form = app.querySelector('form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(form));
      const errors = [];
      form.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
      const invalid = (name, msg) => { errors.push(msg); form[name].classList.add('invalid'); };
      if (!v.name.trim()) invalid('name', 'Name is required.');
      if (!/^\S+@\S+\.\S+$/.test(v.email)) invalid('email', 'Enter a valid email address.');
      if (!/^\d{5}$/.test(v.zip)) invalid('zip', 'Postcode must have 5 digits.');
      if (!v.city.trim()) invalid('city', 'City is required.');
      if (!v.consent) errors.push('Contact consent is required.');
      const errorEl = form.querySelector('[data-testid="form-error"]');
      errorEl.hidden = !errors.length;
      errorEl.textContent = errors.join(' ');
      if (errors.length) return;

      const lead = {
        id: state.nextId++,
        name: v.name.trim(), email: v.email.trim(), phone: v.phone.trim(), zip: v.zip, city: v.city.trim(),
        product: v.product, status: 'new', createdAt: new Date().toISOString(), history: [],
      };
      addHistory(lead, 'Lead created');
      state.leads.push(lead);
      save();
      toast(`Lead "${lead.name}" created`);
      go(`#/leads/${lead.id}`);
    });
  }

  function leadDetailPage(id) {
    const lead = findLead(id);
    if (!lead) {
      shell('leads', '<div class="card empty" data-testid="not-found">Lead not found. <a href="#/leads">Back to leads</a></div>');
      return;
    }
    const closed = lead.status === 'won' || lead.status === 'lost';
    shell('leads', `
      <div class="page-head">
        <div><h1 data-testid="lead-title">${esc(lead.name)}</h1><p>${statusBadge(lead.status)} · created ${date(lead.createdAt)}</p></div>
        <a class="btn" href="#/leads">← All leads</a>
      </div>
      <div class="detail">
        <div>
          <div class="card">
            <h2>Contact</h2>
            <dl class="facts">
              <dt>Email</dt><dd data-testid="lead-detail-email">${esc(lead.email)}</dd>
              <dt>Phone</dt><dd>${esc(lead.phone) || '–'}</dd>
              <dt>Address</dt><dd>${esc(lead.zip)} ${esc(lead.city)}</dd>
              <dt>Product</dt><dd>${PRODUCTS[lead.product]}</dd>
              ${lead.appointment ? `<dt>Site visit</dt><dd data-testid="lead-appointment">${esc(lead.appointment)}</dd>` : ''}
              ${lead.offer ? `<dt>Offer</dt><dd data-testid="lead-offer">${lead.offer.kwp} kWp${lead.offer.battery ? ' + battery' : ''} · <strong>${euro(lead.offer.total)}</strong></dd>` : ''}
            </dl>
          </div>
          <div class="card">
            <h2>History</h2>
            <ul class="timeline" data-testid="lead-history">
              ${lead.history.map((h) => `<li><time>${dateTime(h.at)}</time>${esc(h.text)}</li>`).join('') || '<li>No activity yet.</li>'}
            </ul>
          </div>
        </div>
        <div>
          ${closed ? '' : `
          <form class="card" data-testid="appointment-form">
            <h2>Site visit</h2>
            <div class="field"><label for="appointment">Date</label><input class="input" id="appointment" type="date" data-testid="appointment-date" value="${esc(lead.appointment || '')}"></div>
            <div class="form-actions"><button class="btn btn-primary" type="submit" data-testid="appointment-save">${lead.appointment ? 'Reschedule' : 'Schedule visit'}</button></div>
          </form>
          <form class="card" data-testid="offer-form">
            <h2>Offer</h2>
            <div class="field"><label for="kwp">System size (kWp)</label><input class="input" id="kwp" type="number" min="1" max="30" step="0.5" value="${lead.offer ? lead.offer.kwp : 8}" data-testid="offer-kwp"></div>
            <label class="checkbox" style="margin:12px 0"><input type="checkbox" data-testid="offer-battery" ${lead.product !== 'pv' ? 'checked' : ''}> Add battery storage (${euro(BATTERY_PRICE)})</label>
            <div class="field"><label for="code">Discount code</label><input class="input" id="code" data-testid="offer-code" placeholder="e.g. SUN10"></div>
            <div class="price-box" style="margin-top:12px" data-testid="offer-price">
              <div><span>Subtotal</span><span data-testid="offer-subtotal"></span></div>
              <div><span>Discount</span><span data-testid="offer-discount"></span></div>
              <div class="total"><span>Total</span><span data-testid="offer-total"></span></div>
            </div>
            <div class="field-error" data-testid="offer-error" hidden>Unknown discount code.</div>
            <div class="form-actions"><button class="btn btn-primary" type="submit" data-testid="offer-send">Send offer</button></div>
          </form>
          <div class="card">
            <h2>Close lead</h2>
            <div class="form-actions" style="justify-content:flex-start;margin:0">
              <button class="btn btn-primary" type="button" data-testid="mark-won" ${lead.offer ? '' : 'disabled title="Send an offer first"'}>Mark as won</button>
              <button class="btn btn-danger" type="button" data-testid="mark-lost">Mark as lost</button>
            </div>
          </div>`}
        </div>
      </div>`);
    if (closed) return;

    app.querySelector('[data-testid="appointment-form"]').addEventListener('submit', (e) => {
      e.preventDefault();
      const value = app.querySelector('[data-testid="appointment-date"]').value;
      if (!value) return toast('Pick a date first');
      lead.appointment = value;
      if (lead.status === 'new') lead.status = 'appointment';
      addHistory(lead, `Site visit scheduled for ${value}`);
      save();
      toast('Site visit scheduled');
      route();
    });

    const offerForm = app.querySelector('[data-testid="offer-form"]');
    const inputs = () => ({
      kwp: Number(offerForm.querySelector('[data-testid="offer-kwp"]').value) || 0,
      battery: offerForm.querySelector('[data-testid="offer-battery"]').checked,
      code: offerForm.querySelector('[data-testid="offer-code"]').value,
    });
    const renderPrice = () => {
      const p = calcOffer(inputs());
      offerForm.querySelector('[data-testid="offer-subtotal"]').textContent = euro(p.subtotal);
      offerForm.querySelector('[data-testid="offer-discount"]').textContent = p.discount ? `− ${euro(p.discount)}` : '–';
      offerForm.querySelector('[data-testid="offer-total"]').textContent = euro(p.total);
      offerForm.querySelector('[data-testid="offer-error"]').hidden = p.valid;
    };
    offerForm.addEventListener('input', renderPrice);
    renderPrice();
    offerForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = inputs();
      const p = calcOffer(input);
      if (!p.valid || input.kwp <= 0) return;
      lead.offer = { kwp: input.kwp, battery: input.battery, total: p.total };
      lead.status = 'offer';
      addHistory(lead, `Offer sent: ${input.kwp} kWp, ${euro(p.total)}`);
      save();
      toast('Offer sent');
      route();
    });

    const close = (status, text) => () => {
      lead.status = status;
      addHistory(lead, text);
      save();
      toast(text);
      route();
    };
    app.querySelector('[data-testid="mark-won"]').addEventListener('click', close('won', 'Lead marked as won'));
    app.querySelector('[data-testid="mark-lost"]').addEventListener('click', close('lost', 'Lead marked as lost'));
  }

  // ── Router ──────────────────────────────────────────────────────────────
  function route() {
    const hash = location.hash.replace(/^#/, '') || '/leads';
    if (!state.session && hash !== '/login') return go('#/login');
    if (state.session && hash === '/login') return go('#/leads');
    window.scrollTo(0, 0);
    if (hash === '/login') return loginPage();
    if (hash === '/leads') return leadsPage();
    if (hash === '/leads/new') return newLeadPage();
    const match = /^\/leads\/(\d+)$/.exec(hash);
    if (match) return leadDetailPage(match[1]);
    return go('#/leads');
  }
  window.addEventListener('hashchange', route);
  route();
})();
