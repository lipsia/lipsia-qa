(async function () {
  const { api, escapeHtml, toast, openModal, confirmDialog, formatDateTime, ICONS } = CC;
  const me = await CC.initShell('coverage');

  const STATUS_LABELS = {
    done: 'Done',
    progress: 'In progress',
    partial: 'Partial',
    missing: 'Missing',
    onhold: 'On hold',
    outofscope: 'Out of scope',
  };
  const FIELD_LABELS = { groupName: 'Group', name: 'Name', type: 'Type', status: 'Status', toolFramework: 'Tool / framework', note: 'Note' };
  const $ = (id) => document.getElementById(id);
  let groups = [];
  let statuses = Object.keys(STATUS_LABELS);

  const statusColor = (s) => `var(--status-${s})`;
  const allItems = () => groups.flatMap((g) => g.items);

  // ── Summary ────────────────────────────────────────────────────────────
  function renderSummary() {
    const items = allItems().filter((i) => i.status !== 'outofscope');
    const counts = Object.fromEntries(statuses.map((s) => [s, 0]));
    allItems().forEach((i) => { counts[i.status] = (counts[i.status] || 0) + 1; });
    const total = allItems().length;
    $('summary-percent').textContent = `${items.length ? Math.round((counts.done / items.length) * 100) : 0}%`;
    $('summary-legend').innerHTML = statuses.map((s) =>
      `<span><span class="dot" style="color:${statusColor(s)}"></span>${STATUS_LABELS[s]} ${counts[s] || 0}</span>`).join('');
    $('summary-bar').innerHTML = total
      ? statuses.map((s) => `<span style="width:${((counts[s] || 0) / total) * 100}%;background:${statusColor(s)}"></span>`).join('')
      : '';
  }

  // ── Groups ─────────────────────────────────────────────────────────────
  function statusSelect(item) {
    return `<select class="status-select" data-field="status" style="--status-color:${statusColor(item.status)}" aria-label="Status">
      ${statuses.map((s) => `<option value="${s}" ${s === item.status ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
    </select>`;
  }

  const textInput = (item, field, placeholder) =>
    `<input class="input input-inline input-sm" data-field="${field}" value="${escapeHtml(item[field])}" placeholder="${placeholder}" aria-label="${FIELD_LABELS[field]}">`;

  function groupProgress(items) {
    const relevant = items.filter((i) => i.status !== 'outofscope');
    const done = relevant.filter((i) => i.status === 'done').length;
    return { done, total: relevant.length, pct: relevant.length ? (done / relevant.length) * 100 : 0 };
  }

  function render() {
    renderSummary();
    if (!groups.length) {
      $('groups').innerHTML = `
        <section class="card"><div class="empty">
          <strong>Nothing tracked yet</strong>
          Add the systems or features you want to cover with tests — e.g. “Shop / Checkout” or “Admin / User management”.
        </div></section>`;
      return;
    }
    $('groups').innerHTML = groups.map((g) => {
      const p = groupProgress(g.items);
      return `
        <section class="card">
          <div class="card-head">
            <div class="group-head"><h2>${escapeHtml(g.group)}</h2><span class="badge">${g.items.length}</span></div>
            <div class="group-head"><span class="hint">${p.done}/${p.total} done</span><div class="progress"><span style="width:${p.pct}%;background:var(--success)"></span></div></div>
          </div>
          <div class="card-body flush table-wrap">
            <table class="table coverage-table">
              <thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Tool / framework</th><th>Note</th><th></th></tr></thead>
              <tbody>
                ${g.items.map((item) => `
                  <tr data-id="${item.id}">
                    <td class="col-name">${textInput(item, 'name', 'Name')}</td>
                    <td class="col-type">${textInput(item, 'type', 'e.g. Frontend')}</td>
                    <td class="col-status">${statusSelect(item)}</td>
                    <td class="col-tool">${textInput(item, 'toolFramework', 'e.g. Cypress')}</td>
                    <td class="col-note">${textInput(item, 'note', 'Add a note…')}</td>
                    <td class="col-actions"><button class="icon-btn delete-btn" data-action="delete" title="Delete item" aria-label="Delete item">${ICONS.close}</button></td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </section>`;
    }).join('');
  }

  async function load() {
    try {
      const data = await api('/coverage');
      groups = data.groups;
      statuses = data.statuses;
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function findItem(id) {
    return allItems().find((i) => i.id === id);
  }

  async function save(id, patch) {
    try {
      const { item } = await api(`/coverage/items/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
      Object.assign(findItem(id), item);
      return true;
    } catch (err) {
      toast(err.message, 'error');
      return false;
    }
  }

  const pendingSaves = new Map();
  const saveDebounced = (id, field, value) => {
    const key = `${id}:${field}`;
    clearTimeout(pendingSaves.get(key));
    pendingSaves.set(key, setTimeout(() => { pendingSaves.delete(key); save(id, { [field]: value }); }, 600));
  };

  $('groups').addEventListener('input', (e) => {
    const input = e.target.closest('input[data-field]');
    if (input) saveDebounced(input.closest('tr').dataset.id, input.dataset.field, input.value);
  });

  $('groups').addEventListener('change', async (e) => {
    const select = e.target.closest('select[data-field="status"]');
    if (!select) return;
    if (await save(select.closest('tr').dataset.id, { status: select.value })) render();
  });

  $('groups').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="delete"]');
    if (!btn) return;
    const item = findItem(btn.closest('tr').dataset.id);
    if (!(await confirmDialog(`Delete "${item.name}" from ${item.groupName}?`, { confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api(`/coverage/items/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      toast('Item deleted', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // ── Add item ───────────────────────────────────────────────────────────
  $('add-item-btn').addEventListener('click', () => {
    const modal = openModal({
      title: 'Add coverage item',
      body: `
        <form class="stack" style="gap:14px">
          <div class="form-grid">
            <div class="field"><label for="ci-group">Group</label><input class="input" id="ci-group" list="ci-groups" placeholder="e.g. Shop" required>
              <datalist id="ci-groups">${groups.map((g) => `<option value="${escapeHtml(g.group)}">`).join('')}</datalist></div>
            <div class="field"><label for="ci-name">Name</label><input class="input" id="ci-name" placeholder="e.g. Checkout" required></div>
          </div>
          <div class="form-grid">
            <div class="field"><label for="ci-type">Type</label><input class="input" id="ci-type" placeholder="e.g. Frontend"></div>
            <div class="field"><label for="ci-tool">Tool / framework</label><input class="input" id="ci-tool" value="Cypress"></div>
            <div class="field"><label for="ci-status">Status</label><select class="input" id="ci-status">${statuses.map((s) => `<option value="${s}" ${s === 'missing' ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}</select></div>
          </div>
          <div class="field"><label for="ci-note">Note</label><input class="input" id="ci-note"></div>
        </form>`,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Add item',
          variant: 'brand',
          onClick: async (close) => {
            const v = (id) => modal.body.querySelector(id).value;
            try {
              await api('/coverage/items', {
                method: 'POST',
                body: { groupName: v('#ci-group'), name: v('#ci-name'), type: v('#ci-type'), toolFramework: v('#ci-tool'), status: v('#ci-status'), note: v('#ci-note') },
              });
              close();
              load();
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        },
      ],
    });
  });

  // ── History (admin) ────────────────────────────────────────────────────
  function describe(e) {
    const fmt = (field, value) => (field === 'status' ? STATUS_LABELS[value] || value : value);
    if (e.field === 'created') return `<span class="badge badge-success">Created</span> in ${escapeHtml(e.newValue || '')}`;
    if (e.field === 'deleted') return `<span class="badge badge-danger">Deleted</span> from ${escapeHtml(e.oldValue || '')}`;
    return `<span class="history-change"><span class="muted">${FIELD_LABELS[e.field] || e.field}:</span>
      <del>${escapeHtml(fmt(e.field, e.oldValue) || '∅')}</del> → <strong>${escapeHtml(fmt(e.field, e.newValue) || '∅')}</strong></span>`;
  }

  if (me.role === 'admin') {
    $('history-btn').hidden = false;
    $('history-btn').addEventListener('click', async () => {
      try {
        const { events } = await api('/coverage/history?limit=300');
        openModal({
          title: 'Change history',
          wide: true,
          body: events.length ? `
            <div class="table-wrap"><table class="table history-table">
              <thead><tr><th>Time</th><th>User</th><th>Item</th><th>Change</th></tr></thead>
              <tbody>${events.map((e) => `
                <tr><td class="nowrap muted">${formatDateTime(e.ts)}</td><td class="nowrap">${escapeHtml(e.username || '–')}</td>
                <td>${escapeHtml(e.itemName || e.itemId)}</td><td>${describe(e)}</td></tr>`).join('')}
              </tbody></table></div>` : '<div class="empty">No changes recorded yet.</div>',
        });
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  load();
})();
