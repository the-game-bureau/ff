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
// TWO ROUTES TO THE FORM
// Handing off used to mean a page load, and reading the stored value on
// DOMContentLoaded covered it. It does not any more: js/join-modal.js opens the
// booking form as a popup on the same page, and on that route DOMContentLoaded
// fired long ago, so the address was stored and then never collected. So the
// same apply step is exposed for openJoinModal() to call, and the two routes
// behave alike.
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

  // Safe to call whenever the form appears. One shot by design: it takes the
  // value out of storage as it reads it, so reopening the popup does not put an
  // address back over something since typed.
  function applyPrefill() {
    let identifier = '';
    try {
      identifier = sessionStorage.getItem(KEY) || '';
      // A later visit to the join page should not resurrect it either.
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

    // No booking form on this page at all, or the field already holds
    // something. Typed beats remembered, always.
    if (!field || field.value) return;

    field.value = identifier;
    // So anything watching the field for validation sees the new value.
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // The page-load route: the join page itself, and the hidden popup form that
  // js/join-modal.js builds on every other page.
  document.addEventListener('DOMContentLoaded', applyPrefill);

  // The popup route. Optional on the other side, so a page without this file
  // loaded still opens the form.
  window.ffApplyJoinPrefill = applyPrefill;
})();
