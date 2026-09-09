// ===== JOIN PREFILL =====
// Carries the address typed into the Identify Yourself box over to the join
// page, so someone who realises mid-login that they need an account does not
// type it a second time.
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

    // Only a well-formed address is carried over. A bare "@" was enough under
    // an older test, so a half-typed "munch@" landed in a field it could never
    // satisfy. Anything else is dropped: sign-in is by email address now, so
    // whatever else was typed there is not a name to prefill the username with,
    // it is a half-finished address.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) return;

    const field = document.getElementById('joinEmail');

    // Not the join page, or the field already has something in it.
    if (!field || field.value) return;

    field.value = identifier;
    // So anything watching the field for validation sees the new value.
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
})();
