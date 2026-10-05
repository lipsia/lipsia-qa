(async function () {
  const { api, escapeHtml, toast, openModal, confirmDialog, changePasswordDialog, formatDateTime } = CC;
  const me = await CC.initShell('users');

  const TAG_LABELS = { po: 'Product Owner', dev: 'Developer' };
  const rowsEl = document.getElementById('user-rows');
  let tags = [];

  const tagOptions = (selected) => ['<option value="">—</option>']
    .concat(tags.map((t) => `<option value="${t}" ${t === selected ? 'selected' : ''}>${TAG_LABELS[t] || t}</option>`)).join('');

  function render(users) {
    document.getElementById('user-count').textContent = users.length;
    rowsEl.innerHTML = users.map((u) => {
      const self = u.username.toLowerCase() === me.username.toLowerCase();
      return `
        <tr data-username="${escapeHtml(u.username)}">
          <td>
            <div style="display:flex;align-items:center;gap:10px">
              <span class="avatar">${escapeHtml(u.username.slice(0, 2))}</span>
              <div><strong>${escapeHtml(u.username)}</strong>${self ? ' <span class="badge badge-brand">You</span>' : ''}</div>
            </div>
          </td>
          <td>
            <select class="input input-sm" data-field="role" ${self ? 'disabled title="You cannot change your own role"' : ''} style="width:120px">
              <option value="user" ${u.role === 'user' ? 'selected' : ''}>User</option>
              <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
            </select>
          </td>
          <td><select class="input input-sm" data-field="tag" style="width:160px">${tagOptions(u.tag)}</select></td>
          <td class="muted nowrap">${formatDateTime(u.createdAt)}</td>
          <td class="num nowrap">
            <button class="btn btn-sm" data-action="password" type="button">${self ? 'Change password' : 'Reset password'}</button>
            ${self ? '' : '<button class="btn btn-sm btn-danger" data-action="delete" type="button">Delete</button>'}
          </td>
        </tr>`;
    }).join('') || '<tr><td colspan="5" class="empty">No users yet.</td></tr>';
    CC.stagger(rowsEl.querySelectorAll('tr'));
  }

  async function load() {
    try {
      const data = await api('/users');
      tags = data.tags;
      render(data.users);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  rowsEl.addEventListener('change', async (e) => {
    const select = e.target.closest('select[data-field]');
    if (!select) return;
    const username = select.closest('tr').dataset.username;
    try {
      await api(`/users/${encodeURIComponent(username)}`, { method: 'PATCH', body: { [select.dataset.field]: select.value || null } });
      toast(`Updated ${username}`, 'success');
    } catch (err) {
      toast(err.message, 'error');
      load();
    }
  });

  rowsEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const username = btn.closest('tr').dataset.username;
    if (btn.dataset.action === 'password') {
      changePasswordDialog(username, { self: username.toLowerCase() === me.username.toLowerCase() });
    } else if (btn.dataset.action === 'delete') {
      if (!(await confirmDialog(`Delete the account "${username}"? This cannot be undone.`, { confirmLabel: 'Delete', danger: true }))) return;
      try {
        await api(`/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
        toast(`Deleted ${username}`, 'success');
        load();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  document.getElementById('add-user-btn').addEventListener('click', () => {
    const modal = openModal({
      title: 'Add user',
      body: `
        <form class="stack" style="gap:14px" autocomplete="off">
          <div class="field"><label for="nu-name">Username</label><input class="input" id="nu-name" required></div>
          <div class="field"><label for="nu-pass">Initial password</label><input class="input" id="nu-pass" type="password" autocomplete="new-password" required><span class="field-hint">At least 8 characters. The user can change it after signing in.</span></div>
          <div class="form-grid">
            <div class="field"><label for="nu-role">Role</label><select class="input" id="nu-role"><option value="user">User</option><option value="admin">Admin</option></select></div>
            <div class="field"><label for="nu-tag">Tag</label><select class="input" id="nu-tag">${tagOptions(null)}</select></div>
          </div>
        </form>`,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Create user',
          variant: 'brand',
          onClick: async (close) => {
            const q = (id) => modal.body.querySelector(id).value;
            try {
              await api('/users', { method: 'POST', body: { username: q('#nu-name').trim(), password: q('#nu-pass'), role: q('#nu-role'), tag: q('#nu-tag') || null } });
              toast('User created', 'success');
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

  load();
})();
