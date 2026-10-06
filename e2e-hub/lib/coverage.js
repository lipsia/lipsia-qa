// Test coverage tracker: systems/features grouped by area, each with a status. Every change
// is written to coverage_history (who, what, old → new).
const crypto = require('crypto');
const { db } = require('./db');

const STATUSES = ['done', 'progress', 'partial', 'missing', 'onhold', 'outofscope'];
const EDITABLE_FIELDS = { groupName: 'group_name', name: 'name', type: 'type', status: 'status', toolFramework: 'tool_framework', note: 'note' };

const stmts = {
  all: db.prepare('SELECT * FROM coverage_items ORDER BY sort_order ASC'),
  byId: db.prepare('SELECT * FROM coverage_items WHERE id = ?'),
  nextOrder: db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM coverage_items'),
  insert: db.prepare(`
    INSERT INTO coverage_items (id, group_name, name, type, status, tool_framework, note, sort_order)
    VALUES (@id, @group_name, @name, @type, @status, @tool_framework, @note, @sort_order)
  `),
  remove: db.prepare('DELETE FROM coverage_items WHERE id = ?'),
  history: db.prepare(`
    INSERT INTO coverage_history (ts, item_id, item_name, username, field, old_value, new_value)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  recentHistory: db.prepare('SELECT * FROM coverage_history ORDER BY id DESC LIMIT ?'),
};

const updateStmts = Object.fromEntries(Object.values(EDITABLE_FIELDS).map((col) =>
  [col, db.prepare(`UPDATE coverage_items SET ${col} = ? WHERE id = ?`)]));

function toItem(row) {
  return {
    id: row.id,
    groupName: row.group_name,
    name: row.name,
    type: row.type,
    status: row.status,
    toolFramework: row.tool_framework,
    note: row.note,
  };
}

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function validate(fields) {
  if (fields.status !== undefined && !STATUSES.includes(fields.status)) throw new Error(`Invalid status '${fields.status}'`);
  if (fields.name !== undefined && !clean(fields.name)) throw new Error('Name is required');
  if (fields.groupName !== undefined && !clean(fields.groupName)) throw new Error('Group is required');
}

function listGrouped() {
  const groups = new Map();
  stmts.all.all().forEach((row) => {
    if (!groups.has(row.group_name)) groups.set(row.group_name, { group: row.group_name, items: [] });
    groups.get(row.group_name).items.push(toItem(row));
  });
  return [...groups.values()];
}

function createItem(fields, user) {
  validate({ ...fields, name: fields.name ?? '', groupName: fields.groupName ?? '' });
  const row = {
    id: crypto.randomUUID(),
    group_name: clean(fields.groupName, 120),
    name: clean(fields.name, 200),
    type: clean(fields.type, 120),
    status: fields.status || 'missing',
    tool_framework: clean(fields.toolFramework, 120),
    note: clean(fields.note),
    sort_order: stmts.nextOrder.get().n,
  };
  db.transaction(() => {
    stmts.insert.run(row);
    stmts.history.run(new Date().toISOString(), row.id, row.name, user.username, 'created', null, row.group_name);
  })();
  return toItem(row);
}

/** Applies the given fields and writes one history row per changed field. */
function updateItem(id, fields, user) {
  const row = stmts.byId.get(id);
  if (!row) return null;
  validate(fields);
  const ts = new Date().toISOString();

  db.transaction(() => {
    Object.entries(EDITABLE_FIELDS).forEach(([field, col]) => {
      if (fields[field] === undefined) return;
      const value = field === 'status' ? fields.status : clean(fields[field], field === 'note' ? 500 : 200);
      if (value === row[col]) return;
      stmts.history.run(ts, id, row.name, user.username, field, row[col], value);
      updateStmts[col].run(value, id);
    });
  })();
  return toItem(stmts.byId.get(id));
}

function deleteItem(id, user) {
  const row = stmts.byId.get(id);
  if (!row) return false;
  db.transaction(() => {
    stmts.remove.run(id);
    stmts.history.run(new Date().toISOString(), id, row.name, user.username, 'deleted', row.group_name, null);
  })();
  return true;
}

function history(limit = 200) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000);
  return stmts.recentHistory.all(lim).map((r) => ({
    id: r.id,
    ts: r.ts,
    itemId: r.item_id,
    itemName: r.item_name,
    username: r.username,
    field: r.field,
    oldValue: r.old_value,
    newValue: r.new_value,
  }));
}

module.exports = { STATUSES, listGrouped, createItem, updateItem, deleteItem, history };
