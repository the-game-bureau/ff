(function () {
  const AUTH_SUPABASE_URL = 'https://qmaafbncpzrdmqapkkgr.supabase.co';
  const AUTH_SUPABASE_ANON_KEY = 'sb_publishable_6a9XqxYa0-AZtyrwz4ZeUg_aiMsVH-3';
  const AUTH_STORAGE_KEY = 'law-order-svu-auth-qmaafbncpzrdmqapkkgr';
  const AUTH_PROFILES_TABLE = 'ff_profiles';
  // Must match a Redirect URL configured in Supabase Auth.
  const RESET_REDIRECT_URL = 'https://thegamebureau.com/ff/';
  // Hands whatever was typed into the sign-in box over to the join page.
  // sessionStorage rather than a query string: it keeps an email address out
  // of the URL bar, history, and any referrer.
  const JOIN_PREFILL_KEY = 'ff-join-prefill';

  const authDb = window.supabase ? window.supabase.createClient(AUTH_SUPABASE_URL, AUTH_SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      storageKey: AUTH_STORAGE_KEY,
      storage: window.localStorage,
    },
  }) : null;

  const els = {};
  let signInDismissed = false;

  document.addEventListener('DOMContentLoaded', () => {
    ensureHeaderCorner();
    ensureSignInModal();
    cacheElements();
    bindAuthCorner();
    applyJoinPrefill();
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

    // Username + Escape as one two-segment badge, built the same way as the
    // week badge above it, with a caption under each half.
    if (!document.getElementById('headerUser')) {
      const stack = document.createElement('span');
      stack.className = 'header-id';
      stack.id = 'headerIdStack';
      stack.hidden = true;

      const badge = document.createElement('span');
      badge.className = 'header-id-badge';

      const userEl = document.createElement('span');
      userEl.id = 'headerUser';
      userEl.className = 'header-id-name';
      userEl.setAttribute('aria-live', 'polite');

      const signOutBtn = document.createElement('button');
      signOutBtn.id = 'btnSignOut';
      signOutBtn.className = 'header-id-escape';
      signOutBtn.type = 'button';
      signOutBtn.textContent = 'Escape';

      badge.appendChild(userEl);
      badge.appendChild(signOutBtn);

      const captions = document.createElement('span');
      captions.className = 'header-id-captions';
      for (const text of ['Username', 'Logout']) {
        const caption = document.createElement('span');
        caption.className = 'header-sublabel';
        caption.textContent = text;
        captions.appendChild(caption);
      }

      stack.appendChild(badge);
      stack.appendChild(captions);
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

        <input id="authEmail" type="text" placeholder="Username or Email" aria-label="Username or email" autocomplete="username" />
        <input id="authPass" type="password" placeholder="Password" aria-label="Password" autocomplete="current-password" />

        <div class="modal-actions">
          <button id="btnSignIn" class="btn btn-primary" type="button">Sign In</button>
          <button id="btnResetPassword" class="btn btn-secondary" type="button">Reset Password</button>
          <a id="btnJoinFromSignIn" class="btn btn-secondary" href="${pagePrefix()}join/index.html">Join</a>
        </div>
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
    els.signOut = document.getElementById('btnSignOut');
    els.idStack = document.getElementById('headerIdStack');
    els.close = document.getElementById('btnCloseSignIn');
    els.reset = document.getElementById('btnResetPassword');
    els.headerUser = document.getElementById('headerUser');
    els.headerSignIn = document.getElementById('headerSignIn');
    els.authStack = document.getElementById('headerAuthStack');
    els.joinLink = document.getElementById('btnJoinFromSignIn');
  }

  function bindAuthCorner() {
    els.headerSignIn?.addEventListener('click', () => openSignInModal(true));
    els.close?.addEventListener('click', closeSignInModal);
    els.signIn?.addEventListener('click', signIn);
    els.signOut?.addEventListener('click', signOut);
    els.reset?.addEventListener('click', resetPassword);
    els.joinLink?.addEventListener('click', stashJoinPrefill);

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

      if ((event.target === els.email || event.target === els.password) && event.key === 'Enter') {
        signIn();
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
    const username = String(
      profile?.username ||
      user.user_metadata?.username ||
      user.email ||
      ''
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

    if (els.headerUser) {
      els.headerUser.textContent = signedIn ? username : '';
    }

    if (els.idStack) els.idStack.hidden = !signedIn;
    if (els.authStack) els.authStack.hidden = signedIn;
    if (els.headerSignIn) els.headerSignIn.disabled = false;
  }

  // Supabase only authenticates by email, so a username has to be traded for
  // one first. Anything containing "@" is taken as an email as-is.
  async function resolveLoginEmail(identifier) {
    if (!identifier || identifier.includes('@')) return identifier;
    if (!authDb) return identifier;

    // ilike with no wildcards is an exact, case-insensitive match.
    const { data, error } = await authDb
      .from(AUTH_PROFILES_TABLE)
      .select('email')
      .ilike('username', identifier)
      .maybeSingle();

    // Fall through on a miss and let the sign-in fail with a normal
    // "invalid credentials" rather than leaking whether the name exists.
    if (error || !data?.email) return identifier;
    return data.email;
  }

  async function signIn() {
    if (!authDb) {
      alert('Check-in desk is offline. Refresh and try again.');
      return;
    }

    const identifier = els.email?.value.trim() || '';
    const password = els.password?.value || '';

    if (!identifier || !password) {
      alert('Please enter your username or email, and your password.');
      return;
    }

    const email = await resolveLoginEmail(identifier);
    const { error } = await authDb.auth.signInWithPassword({ email, password });
    if (error) {
      alert(`Sign in error: ${error.message}`);
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
      alert(`Escape failed: ${error.message}`);
      return;
    }

    signInDismissed = false;
    setHeaderUser('');
    broadcastAuthChange(null, null);
  }

  async function resetPassword() {
    if (!authDb) {
      alert('Password reset is offline. Refresh and try again.');
      return;
    }

    const email = els.email?.value.trim() || '';
    if (!email) {
      alert('Please enter your email address first.');
      return;
    }

    const { error } = await authDb.auth.resetPasswordForEmail(email, {
      redirectTo: RESET_REDIRECT_URL,
    });

    if (error) {
      alert(`Password reset error: ${error.message}`);
      return;
    }

    alert('Password reset email sent. Check your inbox and follow the instructions.');
  }

  // Someone who typed their name or email, then realised they need an account,
  // shouldn't have to type it a second time. Stashed on the way out of the
  // popup, spent once on arrival at the join page.
  function stashJoinPrefill() {
    const identifier = els.email?.value.trim() || '';
    try {
      if (identifier) {
        sessionStorage.setItem(JOIN_PREFILL_KEY, identifier);
      } else {
        sessionStorage.removeItem(JOIN_PREFILL_KEY);
      }
    } catch (err) {
      // Storage can be blocked outright (private mode, cookie policy). The
      // prefill is a convenience, so a failure here just means typing it again.
    }
  }

  function applyJoinPrefill() {
    let identifier = '';
    try {
      identifier = sessionStorage.getItem(JOIN_PREFILL_KEY) || '';
      // One shot: a later visit to the join page shouldn't resurrect it.
      sessionStorage.removeItem(JOIN_PREFILL_KEY);
    } catch (err) {
      return;
    }

    if (!identifier) return;

    // Same test sign-in uses to tell an email from a username.
    const field = document.getElementById(
      identifier.includes('@') ? 'joinEmail' : 'joinUsername'
    );

    // Not the join page, or the field is already filled in.
    if (!field || field.value) return;

    field.value = identifier;
    // So anything watching the field for validation sees the new value.
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function pagePrefix() {
    return document.getElementById('siteNav')?.dataset.prefix || '';
  }

  function broadcastAuthChange(user, profile) {
    window.dispatchEvent(new CustomEvent('ff-auth-changed', {
      detail: {
        user,
        profile,
      },
    }));
  }
})();
