(function () {
  const AUTH_SUPABASE_URL = 'https://qmaafbncpzrdmqapkkgr.supabase.co';
  const AUTH_SUPABASE_ANON_KEY = 'sb_publishable_6a9XqxYa0-AZtyrwz4ZeUg_aiMsVH-3';
  const AUTH_STORAGE_KEY = 'law-order-svu-auth-qmaafbncpzrdmqapkkgr';
  const AUTH_PROFILES_TABLE = 'ff_profiles';
  // Must match a Redirect URL configured in Supabase Auth.
  const RESET_REDIRECT_URL = 'https://thegamebureau.com/ff/';

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
    ensureNavAuthItems();
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
    // the left, built by season.js — which is why this checks for the stack
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

  // The same two controls again, as rows at the foot of the phone menu. On a
  // phone the header corner is out of the way (CSS hides it there), so this is
  // where you sign in or escape — and the hamburger stops being the one menu
  // that can't do the two things you most often want from it.
  //
  // Runs after nav.js: both bind DOMContentLoaded and nav.js is loaded first on
  // every page, so the list exists by the time this appends to it. If it ever
  // doesn't, the header corner is still there and nothing here is required.
  function ensureNavAuthItems() {
    const list = document.getElementById('mainNavList');
    if (!list || document.getElementById('navSignInItem')) return;

    const escapeItem = document.createElement('li');
    escapeItem.id = 'navEscapeItem';
    escapeItem.className = 'nav-auth-item';
    escapeItem.hidden = true;
    escapeItem.innerHTML =
      '<button class="nav-btn" id="navSignOut" type="button">Escape</button>' +
      '<span class="nav-sublabel">Sign Out</span>';

    const signInItem = document.createElement('li');
    signInItem.id = 'navSignInItem';
    signInItem.className = 'nav-auth-item';
    signInItem.innerHTML =
      '<button class="nav-btn" id="navSignIn" type="button">Login / Join</button>' +
      '<span class="nav-sublabel">Get In The Game</span>';

    list.appendChild(escapeItem);
    list.appendChild(signInItem);
    // Tells the stylesheet the phone header corner is now redundant.
    document.body.classList.add('has-nav-auth');
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
          <button id="btnSignIn" class="btn btn-primary" type="button">Login</button>
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
    els.navSignIn = document.getElementById('navSignIn');
    els.navSignOut = document.getElementById('navSignOut');
    els.navSignInItem = document.getElementById('navSignInItem');
    els.navEscapeItem = document.getElementById('navEscapeItem');
  }

  // nav.js closes the phone panel on link taps only; these two are buttons.
  function closeNavPanel() {
    document.querySelector('.main-nav.nav-open')?.classList.remove('nav-open');
    document.getElementById('navToggle')?.setAttribute('aria-expanded', 'false');
  }

  function bindAuthCorner() {
    els.headerSignIn?.addEventListener('click', () => openSignInModal(true));
    els.navSignIn?.addEventListener('click', () => {
      closeNavPanel();
      openSignInModal(true);
    });
    els.navSignOut?.addEventListener('click', () => {
      closeNavPanel();
      signOut();
    });
    els.close?.addEventListener('click', closeSignInModal);
    els.signIn?.addEventListener('click', signIn);
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
      if (els.navSignIn) els.navSignIn.disabled = true;
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
      els.headerUser.hidden = !signedIn;
      // Sized after the text lands, never before.
      window.fitHeaderUser?.();
    }

    if (els.idStack) els.idStack.hidden = !signedIn;
    if (els.authStack) els.authStack.hidden = signedIn;
    if (els.headerSignIn) els.headerSignIn.disabled = false;

    // The phone menu carries the same pair and flips with it.
    if (els.navEscapeItem) els.navEscapeItem.hidden = !signedIn;
    if (els.navSignInItem) els.navSignInItem.hidden = signedIn;
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
      alert(`Login error: ${error.message}`);
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
