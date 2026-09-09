(function () {
  const AUTH_CONFIG = window.FF_SUPABASE_CONFIG || {};
  const AUTH_SUPABASE_URL = AUTH_CONFIG.url || 'https://vkoczgzizzppdrpvpemh.supabase.co';
  const AUTH_SUPABASE_ANON_KEY = AUTH_CONFIG.publishableKey || 'sb_publishable_XfvD3zCvnCHT1v_EGE-LJA_3Z9bGjKw';
  const AUTH_STORAGE_KEY = AUTH_CONFIG.storageKey || 'law-order-svu-auth-vkoczgzizzppdrpvpemh';
  const AUTH_PROFILES_TABLE = AUTH_CONFIG.tables?.profiles || 'ff_profiles';
  // Must match a Redirect URL configured in Supabase Auth.
  const RESET_REDIRECT_URL = AUTH_CONFIG.resetRedirectUrl || 'https://thegamebureau.com/ff/';

  const authDb = window.supabase ? window.supabase.createClient(AUTH_SUPABASE_URL, AUTH_SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      storageKey: AUTH_STORAGE_KEY,
      storage: window.localStorage,
    },
  }) : null;

  const els = {};
  let signInDismissed = false;

  // Status goes to the page's own notifications rather than an OS dialog: a
  // native alert blocks the page, cannot be styled, and on a phone lands as a
  // system prompt over a site that looks nothing like it. Falls back to alert()
  // on a page that has not loaded js/toast.js, so a message is never lost.
  function notify(message, kind, key) {
    if (window.ffToast) window.ffToast(message, kind, key || 'auth');
    else window.alert(message);
  }

  // Supabase answers a wrong password and an unknown address with the same
  // string, on purpose: telling them apart would let anyone test whether an
  // address has an account here. That is the right behaviour and the wrong
  // sentence, so it gets said in words, with the next thing to try.
  function signInErrorMessage(error) {
    const message = String(error?.message || '').trim();

    if (error?.code === 'invalid_credentials' || /invalid login credentials/i.test(message)) {
      return 'That address and password do not match an account. Check the address, ' +
        'or use Reset Password.';
    }
    if (/email not confirmed/i.test(message)) {
      return 'That account has not confirmed its email address yet. Check your inbox ' +
        'for the confirmation link.';
    }
    return message ? 'Sign-in failed: ' + message : 'Sign-in failed.';
  }

  document.addEventListener('DOMContentLoaded', () => {
    ensureHeaderCorner();
    ensureSignInModal();
    cacheElements();
    bindAuthCorner();
    refreshAuthCorner();

    if (authDb) {
      authDb.auth.onAuthStateChange(() => refreshAuthCorner(true));
    }

    if (window.location.hash === '#signin') {
      openSignInModal(true);
    }
  });

  function ensureHeaderCorner() {
    const header = document.querySelector('.header');
    const weekBadge = document.getElementById('weekBadge');
    if (!header || !weekBadge) return;

    let corner = header.querySelector('.header-corner');
    if (!corner) {
      corner = document.createElement('div');
      corner.className = 'header-corner';
      const title = header.querySelector('h1');
      header.insertBefore(corner, title || null);
    }

    // The week badge sits on its own in the top-left; only the auth controls
    // belong in this corner.

    let row = corner.querySelector('.header-user-row');
    if (!row) {
      row = document.createElement('div');
      row.className = 'header-user-row';
      corner.appendChild(row);
    }

    // Escape on its own. The username is the third cell of the week badge on
    // the left, built by season.js - which is why this checks for the stack
    // rather than for #headerUser, an id that now always exists.
    if (!document.getElementById('headerIdStack')) {
      const stack = document.createElement('span');
      stack.className = 'header-id';
      stack.id = 'headerIdStack';
      stack.hidden = true;

      const badge = document.createElement('span');
      badge.className = 'header-id-badge header-id-badge-single';

      const signOutBtn = document.createElement('button');
      signOutBtn.id = 'btnSignOut';
      signOutBtn.className = 'header-id-escape';
      signOutBtn.type = 'button';
      signOutBtn.textContent = 'Escape';

      badge.appendChild(signOutBtn);

      // No caption: "Escape" carries its own meaning here.
      stack.appendChild(badge);
      row.appendChild(stack);
    }

    if (!document.getElementById('headerSignIn')) {
      const stack = document.createElement('span');
      stack.className = 'header-id';
      stack.id = 'headerAuthStack';

      const badge = document.createElement('span');
      badge.className = 'header-id-badge header-id-badge-single';

      const signInBtn = document.createElement('button');
      signInBtn.id = 'headerSignIn';
      signInBtn.className = 'header-id-escape';
      signInBtn.type = 'button';
      signInBtn.textContent = 'Login / Join';

      badge.appendChild(signInBtn);
      stack.appendChild(badge);
      row.appendChild(stack);
    }
  }

  function ensureSignInModal() {
    if (document.getElementById('signInModal')) return;

    const modal = document.createElement('div');
    modal.id = 'signInModal';
    modal.className = 'modal-backdrop';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="signInTitle">
        <button class="modal-close" id="btnCloseSignIn" type="button" aria-label="Close">&times;</button>
        <h2 id="signInTitle">Identify Yourself</h2>

        <!-- A real form with named fields and a submit button: that is what
             password managers look for before they offer to fill or save.
             Keep it a form; loose inputs get skipped by most of them. -->
        <form class="modal-form" id="signInForm" method="post" action="#">
          <!-- name and autocomplete still say "username": that is the token
               a password manager looks for to mean "the account identifier", and
               here the identifier is the email address. type="email" is the part
               that changed, so a phone offers the @ key and a malformed address
               is caught before the form submits. -->
          <input id="authEmail" name="username" type="email" placeholder="Email Address" aria-label="Email address" autocomplete="username" />
          <input id="authPass" name="password" type="password" placeholder="Password" aria-label="Password" autocomplete="current-password" />

          <div class="modal-actions">
            <button id="btnSignIn" class="btn btn-primary" type="submit">Login</button>
            <button id="btnResetPassword" class="btn btn-secondary" type="button">Reset Password</button>
          </div>

          <!-- A link, not a third button: this popup is for people who
               already have an account, and joining is the other door rather than
               one more thing to do here. js/join-modal.js intercepts anything
               pointing at the join page and opens the Person of Interest popup in
               place of this one, so the href is both the route and the fallback
               for the join page itself, where that popup stands down. -->
          <a id="btnJoinFromSignIn" class="alt-action-link" href="${pagePrefix()}join/index.html">Not yet joined? Click here to join.</a>
        </form>
      </div>
    `;

    const nav = document.getElementById('siteNav');
    if (nav) {
      nav.insertAdjacentElement('afterend', modal);
    } else {
      document.body.insertBefore(modal, document.body.firstElementChild?.nextSibling || null);
    }
  }

  function cacheElements() {
    els.modal = document.getElementById('signInModal');
    els.email = document.getElementById('authEmail');
    els.password = document.getElementById('authPass');
    els.signIn = document.getElementById('btnSignIn');
    els.form = document.getElementById('signInForm');
    els.signOut = document.getElementById('btnSignOut');
    els.idStack = document.getElementById('headerIdStack');
    els.close = document.getElementById('btnCloseSignIn');
    els.reset = document.getElementById('btnResetPassword');
    els.headerSignIn = document.getElementById('headerSignIn');
    els.authStack = document.getElementById('headerAuthStack');
  }

  function bindAuthCorner() {
    els.headerSignIn?.addEventListener('click', () => openSignInModal(true));
    els.close?.addEventListener('click', closeSignInModal);
    // The form owns submission now: the Login button submits it and Enter in
    // either field submits it, so one listener covers both.
    els.form?.addEventListener('submit', (event) => {
      event.preventDefault();
      signIn();
    });
    if (!els.form) els.signIn?.addEventListener('click', signIn);
    els.signOut?.addEventListener('click', signOut);
    els.reset?.addEventListener('click', resetPassword);

    els.modal?.addEventListener('click', (event) => {
      if (event.target === els.modal) closeSignInModal();
    });

    document.addEventListener('click', (event) => {
      const trigger = event.target.closest('a[href="#signin"]');
      if (!trigger) return;
      event.preventDefault();
      openSignInModal(true);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && els.modal && !els.modal.hidden) {
        closeSignInModal();
      }
    });
  }

  function openSignInModal(force) {
    if (!els.modal) return;
    if (signInDismissed && !force) return;

    els.modal.hidden = false;
    els.email?.focus();
  }

  function closeSignInModal() {
    if (!els.modal) return;
    els.modal.hidden = true;
    signInDismissed = true;
  }

  async function refreshAuthCorner(shouldBroadcast = false) {
    if (!authDb) {
      setHeaderUser('');
      if (els.headerSignIn) els.headerSignIn.disabled = true;
      return;
    }

    const {
      data: { user },
      error,
    } = await authDb.auth.getUser();

    if (error || !user) {
      setHeaderUser('');
      if (shouldBroadcast) broadcastAuthChange(null, null);
      return;
    }

    const profile = await fetchProfile(user.id);
    // Never the email address. It used to be the last fallback, so an account
    // with no profile row - a signup whose profile insert failed, say - had its
    // owner's address printed in the badge on every page, which is the exact
    // thing supabase/sql/ff_profiles_hide_contact.sql was written to stop.
    // UNBOOKED keeps the header in its signed-in state, so ESCAPE is still
    // there, and js/username-gate.js offers to fix it.
    const username = String(
      profile?.username ||
      user.user_metadata?.username ||
      'UNBOOKED'
    ).trim();

    setHeaderUser(username);
    if (shouldBroadcast) broadcastAuthChange(user, profile);
  }

  async function fetchProfile(userId) {
    const { data, error } = await authDb
      .from(AUTH_PROFILES_TABLE)
      .select('username')
      .eq('id', userId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.warn('Header profile fetch failed:', error);
      return null;
    }

    return data || null;
  }

  function setHeaderUser(username) {
    const signedIn = Boolean(username);

    // js/season.js owns the badge cell: it decides whether the handle is plain
    // text or the admin's link, and sizes it.
    window.renderHeaderUser?.(username);

    if (els.idStack) els.idStack.hidden = !signedIn;
    if (els.authStack) els.authStack.hidden = signedIn;
    if (els.headerSignIn) els.headerSignIn.disabled = false;
  }

  // ===== SIGNING IN IS BY EMAIL ADDRESS =====
  // It used to take a username too, trading it for the account's email through
  // the profiles table before calling Supabase. That door is shut: the email
  // column is no longer readable by anon - supabase/sql/ff_profiles_hide_contact.sql
  // closed a leak that handed the whole roster's addresses to anyone holding the
  // publishable key - so the lookup came back with a permission error, the
  // fallback passed the raw username to Supabase as an email, and every username
  // sign-in failed as "invalid credentials" with nothing on screen to explain it.
  // Reopening it would mean an RPC turning any public username into a private
  // email address, which is the same leak through a narrower straw. So the
  // address is the credential everywhere, and the username stays what it always
  // looked like on the page: the name on the placard.
  // Reset Password already read this field as an email, so a typed username was
  // wrong in both directions.

  async function signIn() {
    if (!authDb) {
      notify('Check-in desk is offline. Refresh and try again.', 'bad');
      return;
    }

    const email = els.email?.value.trim() || '';
    const password = els.password?.value || '';

    if (!email || !password) {
      notify('Please enter your email address and your password.', 'note');
      return;
    }

    const { error } = await authDb.auth.signInWithPassword({ email, password });
    if (error) {
      notify(signInErrorMessage(error), 'bad');
      return;
    }

    closeSignInModal();
    if (els.password) els.password.value = '';
    await refreshAuthCorner(true);
  }

  async function signOut() {
    if (!authDb) return;

    const { error } = await authDb.auth.signOut();
    if (error) {
      notify(`Escape failed: ${error.message}`, 'bad');
      return;
    }

    signInDismissed = false;
    setHeaderUser('');
    broadcastAuthChange(null, null);
  }

  async function resetPassword() {
    if (!authDb) {
      notify('Password reset is offline. Refresh and try again.', 'bad', 'reset');
      return;
    }

    const email = els.email?.value.trim() || '';
    if (!email) {
      notify('Please enter your email address first.', 'note', 'reset');
      return;
    }

    // Supabase reports success for an unknown address, so somebody who has
    // never joined would be told to check an inbox nothing was ever sent to.
    // Ask first.
    const { data: registered, error: lookupError } = await authDb.rpc(
      AUTH_CONFIG.rpcs?.emailRegistered || '_2026_email_registered',
      { p_email: email },
    );

    if (!lookupError && registered === false) {
      notify('No account is on file for that address. Use JOIN to book yourself in.', 'bad', 'reset');
      return;
    }

    const { error } = await authDb.auth.resetPasswordForEmail(email, {
      redirectTo: RESET_REDIRECT_URL,
    });

    if (error) {
      notify(`Password reset error: ${error.message}`, 'bad', 'reset');
      return;
    }

    notify('Password reset email sent. Check your inbox, and your spam folder if it is not there.', 'good', 'reset');
  }

  function pagePrefix() {
    return document.getElementById('siteNav')?.dataset.prefix || '';
  }

  // js/username-gate.js calls this after it writes a profile row. Direct,
  // not through ff-auth-changed: the gate listens to that event itself, and
  // would answer its own announcement.
  window.ffRefreshAuthCorner = () => refreshAuthCorner();

  function broadcastAuthChange(user, profile) {
    window.dispatchEvent(new CustomEvent('ff-auth-changed', {
      detail: {
        user,
        profile,
      },
    }));
  }
})();
