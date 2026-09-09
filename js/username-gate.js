// ===== USERNAME GATE =====
// A signed-in account with no row in the profiles table has no name on the
// board: nothing to print on a placard, nothing for a pick to belong to. This
// catches that and asks for one.
//
// WHY IT MOVED HERE
// It used to be markup in index.html driven by js/app.js, so it only existed on
// the home page. Sign in anywhere else in that state and nothing offered to fix
// it - the header simply fell back to printing the account's email address,
// which is both a leak and a dead end. It is a site-wide condition, so it is a
// site-wide module now.
//
// It should almost never be seen. The booking form writes the username into the
// signup metadata, so the usual repair is silent: read it back, insert the row,
// carry on. The gate is for what that leaves - a profile insert that failed
// after the account was created, or a login made somewhere other than here.
(function () {
  const GATE_CONFIG = window.FF_SUPABASE_CONFIG || {};
  const GATE_URL = GATE_CONFIG.url || 'https://vkoczgzizzppdrpvpemh.supabase.co';
  const GATE_KEY = GATE_CONFIG.publishableKey || 'sb_publishable_XfvD3zCvnCHT1v_EGE-LJA_3Z9bGjKw';
  const GATE_STORAGE_KEY = GATE_CONFIG.storageKey || 'law-order-svu-auth-vkoczgzizzppdrpvpemh';
  const GATE_PROFILES = GATE_CONFIG.tables?.profiles || 'ff_profiles';
  // The same rule the booking form enforces.
  const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;

  let checking = false;

  // Reuse whatever client the page already built. A second GoTrue instance on
  // one storage key warns and races.
  const gateDb = (function () {
    for (const name of ['db', 'victimsDb', 'suspectsDb', 'joinDb']) {
      if (window[name]?.auth) return window[name];
    }
    if (!window.supabase) return null;
    return window.supabase.createClient(GATE_URL, GATE_KEY, {
      auth: { persistSession: true, storageKey: GATE_STORAGE_KEY, storage: window.localStorage },
    });
  })();

  document.addEventListener('DOMContentLoaded', () => {
    if (!gateDb) return;
    buildGate();
    check();
    window.addEventListener('ff-auth-changed', check);
  });

  async function check() {
    // check() is also what runs after this module repairs a profile and
    // announces it, so without this it would answer its own broadcast.
    if (checking) return;
    checking = true;

    try {
      const { data: { user } } = await gateDb.auth.getUser();
      if (!user) { closeGate(); return; }

      const { data: profile, error } = await gateDb
        .from(GATE_PROFILES)
        .select('username')
        .eq('id', user.id)
        .maybeSingle();

      // PGRST116 is "no rows", which is the whole point of the check.
      if (error && error.code !== 'PGRST116') {
        console.warn('Username gate could not read the profile:', error);
        return;
      }

      if (profile) { closeGate(); return; }
      if (await repairFromSignupMetadata(user)) return;

      openGate(user);
    } finally {
      checking = false;
    }
  }

  // The booking form puts the username in user_metadata on the way past, so in
  // the ordinary case the row can be rebuilt without asking anyone anything.
  async function repairFromSignupMetadata(user) {
    const username = String(user.user_metadata?.username || '').trim();
    if (!USERNAME_PATTERN.test(username)) return false;

    const { error } = await gateDb.from(GATE_PROFILES).insert({
      id: user.id,
      username,
      email: user.email || null,
    });

    // 23505 means somebody already holds that name, which is a question only
    // the person in front of the screen can answer.
    if (error) {
      if (error.code !== '23505') console.warn('Profile repair failed:', error);
      return false;
    }

    closeGate();
    announce();
    return true;
  }

  function buildGate() {
    if (document.getElementById('usernameGateModal')) return;

    const modal = document.createElement('div');
    modal.id = 'usernameGateModal';
    modal.className = 'modal-backdrop';
    modal.hidden = true;
    modal.innerHTML = [
      '<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="usernameGateTitle">',
      '  <h2 id="usernameGateTitle">Choose a Username</h2>',
      '  <p class="gate-help">Your account has no name on the board yet. This is the name',
      '     on your mugshot placard, visible to the world.</p>',
      '  <form class="modal-form" id="usernameGateForm" novalidate>',
      '    <input id="usernameGateInput" name="username" type="text" placeholder="Username"',
      '           aria-label="Username" autocomplete="nickname" maxlength="20" />',
      '    <div class="modal-actions">',
      '      <button id="btnSaveUsername" class="btn btn-primary" type="submit">Save Username</button>',
      '    </div>',
      '  </form>',
      '  <div id="usernameGateError" class="field-error" role="alert"></div>',
      '</div>'
    ].join('');

    document.body.appendChild(modal);

    // A real form, so Enter saves it and a password manager can offer the handle.
    document.getElementById('usernameGateForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      saveUsername();
    });

    // Deliberately no close button and no backdrop dismiss: without a name the
    // account cannot make a pick or appear in the lineup, so there is nothing
    // useful behind it. Escape still works, because trapping somebody in a
    // dialog is worse than letting them look around first.
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.hidden) closeGate();
    });
  }

  function openGate(user) {
    const modal = document.getElementById('usernameGateModal');
    if (!modal || !modal.hidden) return;

    const input = document.getElementById('usernameGateInput');
    // Offer back whatever they typed at booking, even if it was refused: it is
    // the name they wanted, and a near miss is easier to edit than to retype.
    const attempted = String(user?.user_metadata?.username || '').trim();
    if (input && !input.value && attempted) input.value = attempted;

    modal.hidden = false;
    input?.focus();
  }

  function closeGate() {
    const modal = document.getElementById('usernameGateModal');
    if (modal) modal.hidden = true;
  }

  function setGateError(message) {
    const el = document.getElementById('usernameGateError');
    if (el) el.textContent = message;
  }

  async function saveUsername() {
    const input = document.getElementById('usernameGateInput');
    const username = String(input?.value || '').trim();
    setGateError('');

    if (!USERNAME_PATTERN.test(username)) {
      setGateError('3 to 20 characters. Letters, numbers and underscores only, no spaces.');
      input?.focus();
      return;
    }

    const { data: { user } } = await gateDb.auth.getUser();
    if (!user) {
      setGateError('You have been signed out. Sign in again, then pick a name.');
      return;
    }

    const { error } = await gateDb.from(GATE_PROFILES).insert({
      id: user.id,
      username,
      email: user.email || null,
    });

    if (error) {
      setGateError(error.code === '23505'
        ? 'That username is already booked. Try another handle.'
        : 'Could not save that name: ' + error.message);
      return;
    }

    closeGate();
    announce();
    window.ffToast?.('Booked as ' + username + '.', 'good', 'auth');
  }

  // The header reads the profile itself, so it is told directly rather than
  // through the event: broadcasting is what check() listens to, and this module
  // must not answer itself.
  function announce() {
    window.ffRefreshAuthCorner?.();
    window.dispatchEvent(new CustomEvent('ff-auth-changed', { detail: { user: null, profile: null } }));
  }
})();
