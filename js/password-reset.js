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
  const RESET_SUPABASE_URL = RESET_CONFIG.url || 'https://vkoczgzizzppdrpvpemh.supabase.co';
  const RESET_SUPABASE_ANON_KEY = RESET_CONFIG.publishableKey || 'sb_publishable_XfvD3zCvnCHT1v_EGE-LJA_3Z9bGjKw';
  const RESET_STORAGE_KEY = RESET_CONFIG.storageKey || 'law-order-svu-auth-vkoczgzizzppdrpvpemh';

  const MIN_PASSWORD_LENGTH = RESET_CONFIG.passwordMinLength || 8;

  const resetDb = resolveClient();

  // The session client js/auth-corner.js publishes. Shared rather than rebuilt:
  // a second GoTrue instance on the same storage key races the first for the
  // one-time token in a recovery link.
  //
  // This used to be a ladder over window.db / window.joinDb and so on, which
  // never matched anything - those are top-level `const`s, which are global
  // bindings but not window properties - so it fell through to createClient
  // every time and did the exact thing the comment said it was avoiding.
  //
  // It matters most here: this module listens for PASSWORD_RECOVERY and then
  // calls updateUser, and both only work on the instance that actually consumed
  // the token out of the URL.
  function resolveClient() {
    if (window.ffAuthClient?.auth) return window.ffAuthClient;
    if (!window.supabase) return null;

    // Only reached on a page that somehow has no auth module. Detection stays
    // on here, because with auth-corner absent nothing else is doing it.
    return window.supabase.createClient(RESET_SUPABASE_URL, RESET_SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        detectSessionInUrl: true,
        storageKey: RESET_STORAGE_KEY,
        storage: window.localStorage,
      },
    });
  }

  // A recovery link arrives as #access_token=...&type=recovery, and this is the
  // belt to the PASSWORD_RECOVERY braces: it gets the lightbox up even if the
  // event fired before the listener attached.
  //
  // It deliberately does NOT match a bare ?code=, which is what the PKCE flow
  // uses. That same parameter carries an email confirmation, and popping a "set
  // a new password" box at somebody who just confirmed their address would be
  // wrong. PKCE recovery is covered by the event instead, which is reliable now
  // that this module and the client consuming the token are the same one.
  // Read from what js/auth-corner.js recorded on arrival, not from the live
  // URL: by the time anything here runs, GoTrue may already have parsed the
  // fragment and replaceState'd it away. Falls back to the live URL on a page
  // with no auth module, where nothing is scrubbing anything.
  function landingUrl() {
    const landing = window.ffAuthLanding;
    return {
      hash: landing ? landing.hash : (window.location.hash || ''),
      search: landing ? landing.search : (window.location.search || ''),
    };
  }

  function urlLooksLikeRecovery() {
    const { hash, search } = landingUrl();
    return hash.includes('type=recovery') ||
      (hash.includes('access_token') && hash.includes('recovery')) ||
      search.includes('type=recovery');
  }

  // Supabase answers a spent or expired link by redirecting to the same place
  // with an error in the fragment instead of a session:
  //   #error=access_denied&error_code=otp_expired&error_description=...
  // Nothing looked at that, so the commonest failure of all - a link clicked
  // twice, or one a corporate mail scanner pre-fetched and consumed before its
  // owner ever saw it - arrived as a page that simply did nothing.
  function recoveryError() {
    const { hash, search } = landingUrl();
    const params = new URLSearchParams((hash.replace(/^#/, '') + '&' + search.replace(/^\?/, '')));
    if (!params.get('error') && !params.get('error_code')) return '';

    const described = (params.get('error_description') || '').replace(/\+/g, ' ').trim();
    if (/expired|invalid/i.test(described) || params.get('error_code') === 'otp_expired') {
      return 'That reset link has expired or has already been used. Ask for a new one.';
    }
    return described || 'That reset link could not be used. Ask for a new one.';
  }

  // Strip the token out of the address bar so it is not left in history,
  // bookmarks, or a Referer header on the next navigation. GoTrue usually gets
  // there first; this covers the case where it did not.
  function scrubRecoveryFromUrl() {
    if (!window.location.hash && !window.location.search) return;
    const clean = window.location.pathname + window.location.search.replace(/[?&]type=recovery/, '');
    window.history.replaceState({}, document.title, clean || window.location.pathname);
  }

  // The event can arrive before the lightbox has been built, so it is
  // remembered rather than acted on immediately.
  let recoveryAnnounced = false;

  function onRecovery() {
    recoveryAnnounced = true;
    scrubRecoveryFromUrl();
    if (document.getElementById('resetPasswordModal')) openResetModal();
  }

  // Attached now, at script evaluation, and not inside DOMContentLoaded.
  // PASSWORD_RECOVERY is emitted from the client's own async start-up, which can
  // finish long before the document is ready - and a listener added afterwards
  // never hears it. This is the other half of why a good link did nothing.
  resetDb?.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') onRecovery();
  });

  document.addEventListener('DOMContentLoaded', () => {
    if (!resetDb) return;

    buildResetModal();

    const failed = recoveryError();
    if (failed) {
      // Say so where it will be seen. The lightbox is the wrong place - there
      // is no session to set a password with - so this goes to the page.
      window.ffToast?.(failed, 'bad', 'reset');
      scrubRecoveryFromUrl();
      return;
    }

    // Three ways to know, because each one alone has a hole: the event may have
    // fired before this file was evaluated, and the URL may have been scrubbed
    // before anything read it.
    if (recoveryAnnounced || urlLooksLikeRecovery()) {
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

    setStatus('Password updated. Signing you in...', false);
    setTimeout(() => window.location.reload(), 1200);
  }
})();
