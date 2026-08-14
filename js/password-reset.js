// ===== PASSWORD RECOVERY LIGHTBOX =====
// Supabase emails a recovery link pointing at RESET_REDIRECT_URL. Landing there
// puts a one-time recovery token in the URL fragment; supabase-js consumes it,
// establishes a short-lived recovery session, and fires PASSWORD_RECOVERY.
// This module catches that and puts a "set a new password" lightbox on screen.
//
// Lives on its own so it works no matter which auth module owns the page
// (app.js on the home page, auth-corner.js elsewhere). It reuses app.js's
// client when that exists rather than spinning up a second one.
(function () {
  const RESET_CONFIG = window.FF_SUPABASE_CONFIG || {};
  const RESET_SUPABASE_URL = RESET_CONFIG.url || 'https://qmaafbncpzrdmqapkkgr.supabase.co';
  const RESET_SUPABASE_ANON_KEY = RESET_CONFIG.publishableKey || 'sb_publishable_6a9XqxYa0-AZtyrwz4ZeUg_aiMsVH-3';
  const RESET_STORAGE_KEY = RESET_CONFIG.storageKey || 'law-order-svu-auth-qmaafbncpzrdmqapkkgr';

  const MIN_PASSWORD_LENGTH = 8;

  const resetDb = resolveClient();

  function resolveClient() {
    // app.js publishes its client as a top-level `db`; share it when present.
    // Reuse whatever client the page already built — a second GoTrue instance
    // on the same storage key triggers warnings and races.
    for (const name of ['db', 'victimsDb', 'suspectsDb', 'joinDb']) {
      const existing = window[name];
      if (existing?.auth) return existing;
    }
    if (!window.supabase) return null;

    return window.supabase.createClient(RESET_SUPABASE_URL, RESET_SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        storageKey: RESET_STORAGE_KEY,
        storage: window.localStorage,
      },
    });
  }

  // A recovery link arrives as #access_token=...&type=recovery (or ?code= for
  // PKCE). Either way we want the lightbox up before the token is cleaned off.
  function urlLooksLikeRecovery() {
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    return hash.includes('type=recovery') ||
      (hash.includes('access_token') && hash.includes('recovery')) ||
      search.includes('type=recovery');
  }

  // Strip the token out of the address bar so it is not left in history,
  // bookmarks, or a Referer header on the next navigation.
  function scrubRecoveryFromUrl() {
    if (!urlLooksLikeRecovery()) return;
    const clean = window.location.pathname + window.location.search.replace(/[?&]type=recovery/, '');
    window.history.replaceState({}, document.title, clean || window.location.pathname);
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!resetDb) return;

    buildResetModal();

    // supabase-js parses the fragment on load and emits this.
    resetDb.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        scrubRecoveryFromUrl();
        openResetModal();
      }
    });

    // Belt and braces: if the event fired before this listener attached, the
    // URL still tells us why we are here.
    if (urlLooksLikeRecovery()) {
      scrubRecoveryFromUrl();
      openResetModal();
    }
  });

  function buildResetModal() {
    if (document.getElementById('resetPasswordModal')) return;

    const modal = document.createElement('div');
    modal.id = 'resetPasswordModal';
    modal.className = 'modal-backdrop';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="resetPasswordTitle">
        <h2 id="resetPasswordTitle">Set a New Password</h2>

        <input id="resetPassword1" type="password" placeholder="New Password"
               aria-label="New password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" />
        <input id="resetPassword2" type="password" placeholder="Confirm New Password"
               aria-label="Confirm new password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" />

        <div class="modal-actions">
          <button id="btnSaveNewPassword" class="btn btn-primary" type="button">Save Password</button>
        </div>

        <div id="resetPasswordStatus" class="field-error" role="status" aria-live="polite"></div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('btnSaveNewPassword')
      ?.addEventListener('click', saveNewPassword);

    // Enter submits from either field.
    for (const id of ['resetPassword1', 'resetPassword2']) {
      document.getElementById(id)?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') saveNewPassword();
      });
    }

    // Deliberately no close button or backdrop dismiss: the recovery session is
    // the only thing standing between the user and a locked account, and it
    // does not survive a reload.
  }

  function openResetModal() {
    const modal = document.getElementById('resetPasswordModal');
    if (!modal) return;
    modal.hidden = false;
    document.getElementById('resetPassword1')?.focus();
  }

  function setStatus(message, isError) {
    const el = document.getElementById('resetPasswordStatus');
    if (!el) return;
    el.textContent = message;
    el.style.color = isError ? 'var(--error)' : 'var(--success)';
  }

  async function saveNewPassword() {
    const first = document.getElementById('resetPassword1')?.value || '';
    const second = document.getElementById('resetPassword2')?.value || '';

    if (first.length < MIN_PASSWORD_LENGTH) {
      setStatus(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`, true);
      return;
    }

    if (first !== second) {
      setStatus('Those passwords do not match.', true);
      return;
    }

    // updateUser only succeeds while the recovery session is live, so an
    // expired or reused link fails here rather than silently doing nothing.
    const { error } = await resetDb.auth.updateUser({ password: first });

    if (error) {
      setStatus(`Could not set password: ${error.message}`, true);
      return;
    }

    setStatus('Password updated. Signing you in…', false);
    setTimeout(() => window.location.reload(), 1200);
  }
})();
