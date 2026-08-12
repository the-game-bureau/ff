// ===== JOIN PREFILL =====
// Carries what was typed into the Identify Yourself box over to the join page,
// so someone who realises mid-login that they need an account does not type it
// a second time.
//
// Loaded on every page, because the two halves live on different ones: the
// sign-in modal is static markup on the home page and built by auth-corner.js
// everywhere else, so the Join click is caught by delegation rather than by
// binding the link, which may not exist yet.
//
// sessionStorage rather than a query string: it keeps an email address out of
// the URL bar, the history, and any referrer header.
(function () {
  const KEY = 'ff-join-prefill';

  // Deliberately not the password. Parking one in storage to save a few
  // keystrokes is not a trade worth making, and the join form asks for a new
  // one anyway.
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#btnJoinFromSignIn')) return;

    const identifier = document.getElementById('authEmail')?.value.trim() || '';
    try {
      if (identifier) {
        sessionStorage.setItem(KEY, identifier);
      } else {
        sessionStorage.removeItem(KEY);
      }
    } catch (err) {
      // Storage can be blocked outright (private mode, cookie policy). The
      // prefill is a convenience, so failing here just means typing it again.
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    let identifier = '';
    try {
      identifier = sessionStorage.getItem(KEY) || '';
      // One shot: a later visit to the join page should not resurrect it.
      sessionStorage.removeItem(KEY);
    } catch (err) {
      return;
    }

    if (!identifier) return;

    // Only a well-formed address goes to the email field. A bare "@" was enough
    // under the old test, so a half-typed "munch@" landed in a field it could
    // never satisfy. Anything that fails the check is treated as a username,
    // which is the field someone typing a name meant to fill.
    const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
    const field = document.getElementById(looksLikeEmail ? 'joinEmail' : 'joinUsername');

    // Not the join page, or the field already has something in it.
    if (!field || field.value) return;

    field.value = identifier;
    // So anything watching the field for validation sees the new value.
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
})();
