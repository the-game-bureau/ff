// ===== TOASTS =====
// Status messages as notifications on the page rather than lines inside the
// panel that raised them.
//
// WHY
// Every panel used to carry its own status line: the roster said "12 records on
// file" inside the roster panel, the APB said what it had drawn up inside the
// APB panel, the mugshot editor reported a failed save inside a dialog you
// might have scrolled past. On a page of collapsible panels that is the worst
// place for it - the message can be inside something closed, below the fold, or
// behind a modal, and a save that failed says so somewhere nobody is looking.
//
// These sit above everything instead, in a fixed corner of the window.
//
// ONE MESSAGE PER SOURCE
// Callers pass a key naming what is speaking ('records', 'apb', 'mugshot'), and
// a new message on that key replaces the old one rather than stacking under it.
// Without that, anything that reports on every load piles up a column of
// identical notices.
//
// Failures stay until dismissed. Everything else clears itself: a confirmation
// nobody reads is fine, an error nobody reads is not.
(function () {
  const DISMISS_MS = { good: 4000, note: 5000, bad: 0 };

  let host = null;
  const live = new Map();

  function ensureHost() {
    if (host && document.body.contains(host)) return host;
    host = document.createElement('div');
    host.className = 'toasts';
    // Announced by the browser without stealing focus, which a dialog would.
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
    return host;
  }

  function dismiss(key) {
    const entry = live.get(key);
    if (!entry) return;
    window.clearTimeout(entry.timer);
    entry.el.remove();
    live.delete(key);
  }

  // message: the text. Empty clears whatever that source last said.
  // kind: 'good' | 'bad' | 'note', anything else is neutral.
  // key: what is speaking. Defaults to the message, so unkeyed calls still
  //      replace themselves rather than repeating.
  window.ffToast = function (message, kind, key) {
    const text = String(message == null ? '' : message).trim();
    const id = key || text;

    if (!text) {
      dismiss(id);
      return;
    }

    dismiss(id);

    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' toast-' + kind : '');
    el.textContent = text;
    el.title = 'Click to dismiss';
    el.addEventListener('click', () => dismiss(id));

    ensureHost().appendChild(el);

    const ms = DISMISS_MS[kind];
    const timer = ms ? window.setTimeout(() => dismiss(id), ms) : 0;
    live.set(id, { el: el, timer: timer });
  };

  // For a caller that wants to take a message back without waiting for it to
  // time out - the mugshot editor clearing itself when it opens, say.
  window.ffToastClear = function (key) {
    if (key) dismiss(key);
    else for (const id of [...live.keys()]) dismiss(id);
  };
})();
