// ===== SQUAD ROOM TO DO LIST =====
// A scratchpad for whoever runs the league: the things that have to happen
// before Sunday, kept next to the controls that do them.
//
// WHERE IT LIVES
// public._2026_admin_todos - see supabase/sql/ff_admin_todos.sql. It began in
// localStorage, which meant it lived in one browser on one machine and went
// away with the site data. A list you cannot trust to still be there is not a
// list.
//
// Plain table reads and writes rather than the SECURITY DEFINER functions the
// rest of this page uses. Those exist because their tables hold columns some
// roles must not read; nothing here is like that, so row-level security says
// the whole rule and PostgREST does the rest. The policies allow the admin and
// nobody else, so the gate on this panel is a courtesy and the database is the
// actual lock.
//
// The screen is redrawn from what the database returns rather than from what
// was typed, so what you are looking at is what is stored.
//
// NOTHING IS DELETED
// The X files a row away rather than destroying it: archived is set and the row
// stops being listed. The browser has no DELETE on the table at all, so this is
// not a convention it could break by accident.
//
// And the X only exists on a row that has been ticked off. Filing something
// away is how a job leaves the board, so the board should only let go of jobs
// that are finished - a half-done line takes a deliberate tick before it can be
// cleared, rather than one click on a small button next to it.
(function () {
  const TODO_CONFIG = window.FF_SUPABASE_CONFIG || {};
  const TODOS_TABLE = TODO_CONFIG.tables?.adminTodos || '_2026_admin_todos';

  let items = [];
  let editingId = '';
  let busy = false;

  const els = {};

  // js/auth-corner.js publishes the session client, and it is loaded before
  // this file on the admin page. Sharing it matters: a second GoTrue instance
  // on one storage key races the first.
  const todoDb = window.ffAuthClient?.auth ? window.ffAuthClient : null;

  document.addEventListener('DOMContentLoaded', () => {
    els.panel = document.getElementById('adminTodoPanel');
    els.list = document.getElementById('adminTodoList');
    els.input = document.getElementById('adminTodoInput');
    els.form = document.getElementById('adminTodoForm');
    els.count = document.getElementById('adminTodoCount');
    if (!els.list) return;

    render();

    els.form?.addEventListener('submit', (event) => {
      event.preventDefault();
      add();
    });

    // Delegated: every row is rebuilt on every change.
    els.list.addEventListener('change', (event) => {
      const done = event.target.closest('[data-todo-done]');
      if (done) toggle(done.dataset.todoDone, done.checked);
    });

    els.list.addEventListener('click', (event) => {
      const remove = event.target.closest('[data-todo-remove]');
      if (remove) { archive(remove.dataset.todoRemove); return; }

      const text = event.target.closest('[data-todo-text]');
      if (text) startEditing(text.dataset.todoText);
    });

    // Enter commits an edit, Escape abandons it. Both are what a one-line text
    // field is expected to do, and neither is a browser default here because
    // the field only exists while a row is being edited.
    els.list.addEventListener('keydown', (event) => {
      const field = event.target.closest('[data-todo-edit]');
      if (!field) return;

      if (event.key === 'Enter') {
        event.preventDefault();
        commitEdit(field.dataset.todoEdit, field.value);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        editingId = '';
        render();
      }
    });

    // Clicking away keeps what was typed. Losing an edit because the mouse
    // moved is the wrong way round.
    els.list.addEventListener('focusout', (event) => {
      const field = event.target.closest('[data-todo-edit]');
      if (field) commitEdit(field.dataset.todoEdit, field.value);
    });

    load();
    window.addEventListener('ff-auth-changed', load);
  });

  // js/admin.js calls this the moment the gate opens, so the list is already
  // there when the panel appears rather than arriving a beat later.
  window.ffAdminTodoLoad = load;

  function fail(message, error) {
    console.error('To do list:', error || message);
    const missing = error && (error.code === '42P01' ||
      /relation .* does not exist|could not find the table/i.test(error.message || ''));
    window.ffToast?.(
      missing
        ? 'To do list is not switched on yet: run supabase/sql/ff_admin_todos.sql.'
        : message + (error?.message ? ' ' + error.message : ''),
      'bad',
      'todo'
    );
  }

  async function load() {
    if (!todoDb) return;

    // Signed out, or signed in as anybody else, this returns nothing at all -
    // the policies see to that - so there is no separate permission check here.
    const { data, error } = await todoDb
      .from(TODOS_TABLE)
      .select('id, body, done, created_at')
      // Filed-away rows are still there; they are simply not the list any more.
      .eq('archived', false)
      // What is left to do, first. Ticking something sends it to the bottom
      // rather than leaving it in the middle of the list to be read past.
      // Newest first inside each half, so a line typed while reading the list
      // appears where the eye already is.
      .order('done', { ascending: true })
      .order('created_at', { ascending: false });

    if (error) {
      // Not worth a message when nobody is signed in: the panel is not on
      // screen, and a passer-by has nothing to fix.
      const { data: { user } } = await todoDb.auth.getUser();
      if (user) fail('To do list could not be read.', error);
      return;
    }

    items = data || [];
    render();
  }

  async function add() {
    if (busy || !todoDb) return;

    const body = String(els.input?.value || '').trim();
    if (!body) return;

    busy = true;
    const { error } = await todoDb.from(TODOS_TABLE).insert({ body });
    busy = false;

    if (error) { fail('That could not be added.', error); return; }

    els.input.value = '';
    await load();
    els.input.focus();
  }

  // The box has already flipped itself by the time this runs, so the wanted
  // state comes from the box rather than from negating what was on file - which
  // would fight it if the two ever disagreed.
  async function toggle(id, done) {
    const item = items.find((entry) => entry.id === id);
    if (!item || !todoDb) return;

    const { error } = await todoDb
      .from(TODOS_TABLE)
      .update({ done: Boolean(done) })
      .eq('id', id);

    if (error) { fail('That could not be changed.', error); return; }
    await load();
  }

  // Off the list, still in the table. archived_at is stamped by the trigger, so
  // the database decides what time it was rather than whatever clock this
  // browser is running.
  async function archive(id) {
    if (!todoDb) return;

    const { error } = await todoDb.from(TODOS_TABLE).update({ archived: true }).eq('id', id);
    if (error) { fail('That could not be filed away.', error); return; }
    await load();
  }

  function startEditing(id) {
    editingId = id;
    render();
    const field = els.list.querySelector('[data-todo-edit]');
    field?.focus();
    field?.select();
  }

  async function commitEdit(id, value) {
    const item = items.find((entry) => entry.id === id);
    editingId = '';

    if (!item || !todoDb) { render(); return; }

    const body = String(value || '').trim();

    // Emptying a line files it away, the same as the X - and under the same
    // rule, so a line that is not ticked off simply comes back. The column
    // carries a not-blank check, so an empty row is not something the database
    // would hold either way.
    if (!body) {
      if (item.done) { await archive(id); return; }
      window.ffToast?.('Tick it off first, then it can be filed away.', 'note', 'todo');
      render();
      return;
    }

    // Unchanged, so nothing is sent. Every save here costs a round trip, and
    // clicking a line to read it should not write to the database.
    if (body === item.body) { render(); return; }

    const { error } = await todoDb.from(TODOS_TABLE).update({ body }).eq('id', id);
    if (error) { fail('That could not be saved.', error); return; }
    await load();
  }

  function render() {
    if (!els.list) return;

    const open = items.filter((item) => !item.done).length;
    if (els.count) {
      els.count.textContent = items.length ? `${open} open of ${items.length}` : '';
    }

    if (!items.length) {
      els.list.innerHTML = '<li class="admin-todo-empty">Nothing on the board.</li>';
      return;
    }

    els.list.innerHTML = items.map((item) => {
      if (item.id === editingId) {
        return `
          <li class="admin-todo-item">
            <input class="admin-todo-edit" type="text" data-todo-edit="${escapeHtml(item.id)}"
                   value="${escapeHtml(item.body)}" aria-label="Edit item"/>
          </li>`;
      }

      return `
        <li class="admin-todo-item${item.done ? ' admin-todo-item-done' : ''}">
          <span class="admin-todo-tick">
            <input type="checkbox" data-todo-done="${escapeHtml(item.id)}" ${item.done ? 'checked' : ''}
                   aria-label="${escapeHtml(item.done ? 'Mark as not done: ' + item.body : 'Mark as done: ' + item.body)}"/>
          </span>
          <button class="admin-todo-text" type="button" data-todo-text="${escapeHtml(item.id)}"
                  title="Click to edit">${escapeHtml(item.body)}</button>
          ${item.done
            ? `<button class="admin-todo-remove" type="button" data-todo-remove="${escapeHtml(item.id)}"
                  aria-label="${escapeHtml('File away: ' + item.body)}">&times;</button>`
            // An empty cell rather than no cell, so the text column is the same
            // width whether a row can be filed away or not.
            : '<span class="admin-todo-spacer"></span>'}
        </li>`;
    }).join('');
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
