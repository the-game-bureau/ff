const FF_CONFIG = window.FF_SUPABASE_CONFIG || {};
const SUPABASE_URL = FF_CONFIG.url || 'https://vkoczgzizzppdrpvpemh.supabase.co';
const SUPABASE_ANON_KEY = FF_CONFIG.publishableKey || 'sb_publishable_XfvD3zCvnCHT1v_EGE-LJA_3Z9bGjKw';
const PROFILES_TABLE = FF_CONFIG.tables?.profiles || 'ff_profiles';
const PICKS_TABLE = FF_CONFIG.tables?.picks || 'ff_picks';
// Where Supabase sends the password-recovery link. This exact URL must be
// listed under Authentication > URL Configuration > Redirect URLs.
const RESET_REDIRECT_URL = FF_CONFIG.resetRedirectUrl || 'https://thegamebureau.com/ff/';
const NO_ACCOUNT_MESSAGE = 'No 2026 account is on file for that email.\n\n'
  + 'Previous year accounts were not activated for this season. '
  + 'Use JOIN to book yourself in, then sign in with the password you set there.';

// FIXED: Added session persistence to prevent auth cycling
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    storageKey: FF_CONFIG.storageKey || 'law-order-svu-auth-vkoczgzizzppdrpvpemh',
    storage: window.localStorage
  }
});

// Team data now lives in js/teams.js so the victims page can share it.
const nflTeams = NFL_TEAMS;


// SEASON and CURRENT_WEEK now live in js/season.js, which every page loads so
// the header's week badge and the game can never disagree.
let gameState = {
  currentWeek: CURRENT_WEEK,
  usedTeams: [],
  selectedTeam: null,
  isActive: true,
  weeklyPicks: [],
  lastWeekAdvancement: 0
};

let currentUser = null;
let currentProfile = null;
let globalTeamCounts = new Map(); // Store team pick counts globally
let allPicksData = []; // Store all picks data globally for week navigation
let refreshPickTicker = null;
let currentPickTickerWeek = Math.max(1, CURRENT_WEEK - 1); // Track current week in Pick Ticker (one week behind)

function getCentralNow(){
  const now = new Date();
  return new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
}

function escapeHtml(value){
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pickTimestamp(pick){
  return pick?.submitted_at_utc || pick?.created_at || '1970-01-01T00:00:00Z';
}

function isCurrentSeasonPick(pick){
  return !pick.season || Number(pick.season) === Number(SEASON);
}

// A week that was released so its team could be used elsewhere. See the same
// pair in js/victims.js, which is where skip rows are written; keep them in
// step. A skipped week counts as unpicked everywhere: standings, timeline,
// ticker and the roll call all read what this returns.
const PICK_SKIP_RESULT = 'SKIP';

function isSkippedPick(pick){
  return String(pick?.result || '').trim().toUpperCase() === PICK_SKIP_RESULT;
}

function activePicksFromHistory(picks){
  const latestByUserWeek = new Map();

  for(const pick of (picks || []).filter(isCurrentSeasonPick)){
    const key = `${pick.user_id || pick.username || 'unknown'}:${Number(pick.week)}`;
    const previous = latestByUserWeek.get(key);
    if(!previous || new Date(pickTimestamp(pick)) > new Date(pickTimestamp(previous))){
      latestByUserWeek.set(key, pick);
    }
  }

  // Filtered after the newest row per week is chosen, so a skip can outrank the
  // pick it releases.
  return [...latestByUserWeek.values()].filter(pick => !isSkippedPick(pick)).sort((a, b) => {
    const weekDiff = Number(a.week) - Number(b.week);
    if(weekDiff !== 0) return weekDiff;
    return new Date(pickTimestamp(a)) - new Date(pickTimestamp(b));
  });
}

function currentUserActivePicks(){
  return activePicksFromHistory(gameState.weeklyPicks || []);
}

function currentWeekPick(){
  return currentUserActivePicks().find(pick => Number(pick.week) === Number(gameState.currentWeek)) || null;
}

function currentPickLocked(){
  const activePick = currentWeekPick();
  return activePick ? scheduleInfoForTeam(activePick.team).locked : false;
}

function scheduleInfoForTeam(teamName){
  return window.NFL_SCHEDULE_HELPERS?.getTeamScheduleInfo?.(teamName, gameState.currentWeek) || {
    game: null,
    opponent: '',
    opponentShort: '',
    homeAway: 'BYE',
    line: 'BYE',
    locked: true,
    isBye: true,
    isTbd: false
  };
}

function matchupText(info){
  if(info.isBye) return 'BYE';
  return `${info.homeAway} ${info.opponentShort || info.opponent}`;
}

function schedulePickColumnsUnsupported(error){
  const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
  return error?.code === 'PGRST204' ||
    error?.code === '42703' ||
    (text.includes('column') && (
      text.includes('season') ||
      text.includes('submitted_at_utc') ||
      text.includes('opponent') ||
      text.includes('home_away') ||
      text.includes('kickoff_at_utc') ||
      text.includes('schedule_source_url')
    ));
}

function profileNameColumnsUnsupported(error){
  const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
  return error?.code === 'PGRST204' ||
    error?.code === '42703' ||
    (text.includes('column') && (text.includes('first_name') || text.includes('last_name')));
}

function profileAvatarColumnUnsupported(error){
  const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
  return error?.code === 'PGRST204' && text.includes('avatar_data_url') ||
    error?.code === '42703' && text.includes('avatar_data_url') ||
    (text.includes('column') && text.includes('avatar_data_url'));
}

async function insertProfileWithOptionalNames(row){
  const result = await db.from(PROFILES_TABLE).insert(row);
  if(result.error && profileAvatarColumnUnsupported(result.error)){
    const rowWithoutAvatar = { ...row };
    delete rowWithoutAvatar.avatar_data_url;
    const retry = await db.from(PROFILES_TABLE).insert(rowWithoutAvatar);
    if(retry.error && profileNameColumnsUnsupported(retry.error)){
      return await db
        .from(PROFILES_TABLE)
        .insert({
          id: row.id,
          username: row.username,
          email: row.email
        });
    }

    return retry;
  }

  if(result.error && profileNameColumnsUnsupported(result.error)){
    return await db
      .from(PROFILES_TABLE)
      .insert({
        id: row.id,
        username: row.username,
        email: row.email
      });
  }

  return result;
}

// Removed: autoFitPlayerName function no longer needed since playerName element was removed

// FIXED: Debug version with detailed logging
// ===== SIGN-IN POPUP =====
// Opens itself whenever nobody is signed in. Dismissing it lets you browse the
// site signed out, and it stays dismissed until the next page load.
let signInDismissed = false;

function openSignInModal(force){
  const modal = document.getElementById('signInModal');
  if(!modal) return;
  if(signInDismissed && !force) return;

  modal.hidden = false;
  const emailEl = document.getElementById('authEmail');
  if(emailEl) emailEl.focus();
}

function closeSignInModal(){
  const modal = document.getElementById('signInModal');
  if(!modal) return;
  modal.hidden = true;
  signInDismissed = true;
}

// Supabase only authenticates by email, so a username has to be traded for one
// first. Anything containing "@" is taken as an email as-is.
// NOTE: js/auth-corner.js carries a twin of this for the pages it owns; keep
// the two in step until one auth module owns every page.
async function resolveLoginEmail(identifier){
  if(!identifier || identifier.includes('@')) return identifier;

  // ilike with no wildcards is an exact, case-insensitive match.
  const { data, error } = await db
    .from(PROFILES_TABLE)
    .select('email')
    .ilike('username', identifier)
    .maybeSingle();

  // Fall through on a miss so sign-in fails with a normal "invalid
  // credentials" instead of revealing whether the name exists.
  if(error || !data?.email) return identifier;
  return data.email;
}

// The username under the week badge, top-right. Hidden entirely when signed
// out or before a username has been chosen.
function setHeaderUser(username){
  // Signed in shows the name in the week badge plus the Escape badge on the
  // right; signed out shows Login / Join.
  const el = document.getElementById('headerUser');
  const idStack = document.getElementById('headerIdStack');
  const signInBtn = document.getElementById('headerSignIn');
  const signedIn = Boolean(username);

  if(el){
    el.textContent = signedIn ? username : '';
    el.hidden = !signedIn;
    // Sized after the text lands, never before.
    window.fitHeaderUser?.();
  }

  if(idStack) idStack.hidden = !signedIn;

  const authStack = document.getElementById('headerAuthStack');
  if(authStack) authStack.hidden = signedIn;
  else if(signInBtn) signInBtn.hidden = signedIn;
}

async function refreshAuthUI(){
  try {
    const { data: { user } } = await db.auth.getUser();
    currentUser = user || null;
    
    // DEBUG: Log current user
    console.log('🔍 Current user:', currentUser?.id, currentUser?.email);

    const loggedOutEl = document.getElementById('authWhenLoggedOut');
    const loggedInEl = document.getElementById('authWhenLoggedIn');
    const usernameGateEl = document.getElementById('usernameGate');
    const displayUserEl = document.getElementById('displayUser');
    const submitPickEl = document.getElementById('submitPick');
    const statusBarEl = document.getElementById('statusBar');

    if(!currentUser){
      if (loggedOutEl) loggedOutEl.style.display = 'flex';
      if (loggedInEl) loggedInEl.style.display = 'none';
      if (usernameGateEl) usernameGateEl.style.display = 'none';
      if (displayUserEl) displayUserEl.textContent = '';
      setHeaderUser(null);
      if (statusBarEl) statusBarEl.style.display = 'none';

      if (submitPickEl) {
        submitPickEl.disabled = true;
      }
      // No auto-popup on load. Signing in is opened deliberately: the header's
      // Identify Yourself button, a #signin link, or the /#signin hash.
      updateStatus();
      return;
    }

    closeSignInModal();
    if (loggedOutEl) loggedOutEl.style.display = 'none';
    if (loggedInEl) loggedInEl.style.display = 'flex';
    if (statusBarEl) statusBarEl.style.display = 'grid';

    // DEBUG: Log the profile fetch attempt
    console.log('🔍 Fetching profile for user ID:', currentUser.id);
    
    // Ask for the one column this code actually reads. "*" demands every
    // column, so a single field the role is not granted fails the whole
    // request — and it pulls the email down to the browser for nothing.
    const { data: profile, error } = await db
      .from(PROFILES_TABLE)
      .select('username')
      .eq('id', currentUser.id)
      .maybeSingle();

    // DEBUG: Log the results
    console.log('🔍 Profile fetch result:', { profile, error });
    
    if(error && error.code !== 'PGRST116') {
      console.error('❌ Profile fetch error:', error);
      // Not every failure carries a PostgREST code: when the error body is not
      // JSON, supabase-js falls back to the HTTP status text ("Bad Request")
      // and leaves code undefined. Print only the parts that exist so the
      // message never trails a literal "undefined".
      const detail = [error.code, error.status, error.hint].filter(Boolean).join(' · ');
      alert(`Profile fetch error: ${error.message}${detail ? ` (${detail})` : ''}`);
      return;
    }

    if(!profile){
      const pendingUsername = (currentUser?.user_metadata?.username || '').trim();
      if(/^[a-zA-Z0-9_]{3,20}$/.test(pendingUsername)){
        const { error: createProfileError } = await insertProfileWithOptionalNames({
          id: currentUser.id,
          username: pendingUsername,
          email: currentUser?.email || null,
          first_name: (currentUser?.user_metadata?.first_name || '').trim() || null,
          last_name: (currentUser?.user_metadata?.last_name || '').trim() || null,
          avatar_data_url: currentUser?.user_metadata?.avatar_data_url || null
        });

        if(!createProfileError){
          await refreshAuthUI();
          return;
        }

        if(createProfileError.code !== '23505'){
          console.warn('Profile auto-create from join metadata failed:', createProfileError);
        }
      }
      console.log('⚠️ No profile found, showing username gate');
      if (usernameGateEl) {
        usernameGateEl.style.display = 'block';
        usernameGateEl.setAttribute('aria-hidden', 'false');
      }
      currentProfile = null;
      if (displayUserEl) displayUserEl.textContent = '(set username)';
      setHeaderUser(null);
      const usernameInputEl = document.getElementById('usernameInput');
      if(usernameInputEl && pendingUsername) usernameInputEl.value = pendingUsername;
      // Removed: playerName element no longer exists
      updateStatus();
    }else{
      console.log('✅ Profile found:', profile.username);
      if (usernameGateEl) {
        usernameGateEl.style.display = 'none';
        usernameGateEl.setAttribute('aria-hidden', 'true');
      }
      currentProfile = profile;
      if (displayUserEl) displayUserEl.textContent = profile.username;
      setHeaderUser(profile.username);
      // Removed: playerName element no longer exists

      await loadUserPicksAndDisableTeams();
    }
  } catch(error) {
    console.error('❌ Auth refresh error:', error);
    alert(`Auth refresh error: ${error.message}`);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const btnSignInEl = document.getElementById('btnSignIn');
  const btnSignOutEl = document.getElementById('btnSignOut');

  // Popup open/close: the header's Login / Join button, any #signin link, the
  // X, the backdrop, and Escape. #btnOpenSignIn is a leftover from the old
  // in-page prompt and no longer exists on any page; the lookup is harmless
  // and stays only so an older page dropped back in would still work.
  const btnOpenSignInEl = document.getElementById('btnOpenSignIn');
  const btnCloseSignInEl = document.getElementById('btnCloseSignIn');
  const signInModalEl = document.getElementById('signInModal');

  if (btnOpenSignInEl) {
    btnOpenSignInEl.addEventListener('click', () => openSignInModal(true));
  }

  if (btnCloseSignInEl) {
    btnCloseSignInEl.addEventListener('click', closeSignInModal);
  }

  const headerSignInEl = document.getElementById('headerSignIn');
  if (headerSignInEl) {
    headerSignInEl.addEventListener('click', () => openSignInModal(true));
  }

  if (signInModalEl) {
    // Clicking the dark area outside the card closes it.
    signInModalEl.addEventListener('click', (e) => {
      if (e.target === signInModalEl) closeSignInModal();
    });
  }

  // The nav is injected by nav.js, so listen at the document level.
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('a[href="#signin"]');
    if (trigger) {
      e.preventDefault();
      openSignInModal(true);
    }
  });

  if (window.location.hash === '#signin') openSignInModal(true);
  const btnResetPasswordEl = document.getElementById('btnResetPassword');
  const btnSaveUsernameEl = document.getElementById('btnSaveUsername');
  const submitPickEl = document.getElementById('submitPick');

  if (btnSignInEl) {
    btnSignInEl.addEventListener('click', async () => {
      const identifier = document.getElementById('authEmail').value.trim();
      const password = document.getElementById('authPass').value;

      if(!identifier || !password) {
        alert('Please enter your username or email, and your password.');
        return;
      }

      try {
        const email = await resolveLoginEmail(identifier);
        const { data, error } = await db.auth.signInWithPassword({
          email,
          password
        });
        
        if(error) {
          alert('Login error: ' + error.message);
        } else {
          console.log('✅ Login successful');
          await refreshAuthUI();
        }
      } catch(error) {
        console.error('Signin error:', error);
        alert('An unexpected error occurred during sign in.');
      }
    });
  }

  if (btnResetPasswordEl) {
    btnResetPasswordEl.addEventListener('click', async () => {
      const email = document.getElementById('authEmail').value.trim();
      
      if(!email) {
        alert('Please enter your email address first.');
        return;
      }

      try {
        // Supabase reports success for an unknown address, so a 2025 player
        // would be told to check an inbox nothing was ever sent to. Ask first.
        const { data: registered, error: lookupError } = await db.rpc(
          FF_CONFIG.rpcs?.emailRegistered || '_2026_email_registered',
          { p_email: email },
        );

        if (!lookupError && registered === false) {
          alert(NO_ACCOUNT_MESSAGE);
          return;
        }

        const { error } = await db.auth.resetPasswordForEmail(email, {
          // Derived from wherever the page is actually served, so this keeps
          // working on both lawandorder-svu.app and the GitHub Pages URL.
          // Both origins must be listed as Supabase redirect URLs.
          redirectTo: RESET_REDIRECT_URL,
        });
        
        if(error) {
          alert('Password reset error: ' + error.message);
        } else {
          alert('Password reset email sent! Check your inbox and follow the instructions.');
        }
      } catch(error) {
        console.error('Password reset error:', error);
        alert('An unexpected error occurred during password reset.');
      }
    });
  }

  if (btnSignOutEl) {
    btnSignOutEl.addEventListener('click', async () => {
      try {
        await db.auth.signOut();
        gameState.selectedTeam = null;
        // An escape is deliberate, so let the popup come back.
        signInDismissed = false;
        await refreshAuthUI();
        renderTeams();
        updateStatus();
      } catch(error) {
        console.error('Signout error:', error);
      }
    });
  }

  if (btnSaveUsernameEl) {
    btnSaveUsernameEl.addEventListener('click', async () => {
      const username = document.getElementById('usernameInput').value.trim();
      const errorEl = document.getElementById('usernameError');
      
      errorEl.textContent = '';

      if(!username || !/^[a-zA-Z0-9_]{3,20}$/.test(username)){
        errorEl.textContent = 'Your publicly visible username must be 3–20 characters, letters/numbers/underscore only.';
        return;
      }

      const email = currentUser?.email || null;

      try {
        const { error } = await db
          .from(PROFILES_TABLE)
          .insert({ 
            id: currentUser.id, 
            username: username, 
            email: email 
          });

        if(error){
          if(error.code === '23505') {
            errorEl.textContent = 'That username is already taken.';
          } else {
            errorEl.textContent = 'Error creating profile: ' + error.message;
          }
          return;
        }

        const usernameGateEl = document.getElementById('usernameGate');
        if (usernameGateEl) {
          usernameGateEl.style.display = 'none';
          usernameGateEl.setAttribute('aria-hidden', 'true');
        }
        await refreshAuthUI();
        
      } catch(error) {
        console.error('Username save error:', error);
        errorEl.textContent = 'An unexpected error occurred.';
      }
    });
  }

  if (submitPickEl) {
    submitPickEl.addEventListener('click', submitPick);
  }

  // Pick Ticker — an inline section on the page now, not a floating panel.
  const prevPickWeekBtn = document.getElementById('prevPickWeekBtn');
  const nextPickWeekBtn = document.getElementById('nextPickWeekBtn');
  const pickTickerWeekEl = document.getElementById('pickTickerWeek');

  function maxTickerWeek() {
    return Math.max(...allPicksData.map(p => p.week), gameState.currentWeek);
  }

  function renderPickTickerForWeek(week) {
    const floatingPicksBody = document.getElementById('floatingPicksBody');
    if (!floatingPicksBody) return;

    // Picks for the selected week, newest first
    const weekPicks = allPicksData.filter(pick => pick.week === week);
    weekPicks.sort((a, b) => new Date(pickTimestamp(b)) - new Date(pickTimestamp(a)));

    if (pickTickerWeekEl) pickTickerWeekEl.textContent = `Week ${week}`;

    const pickRows = weekPicks.map(pick => {
      const createdAt = new Date(pickTimestamp(pick));
      const timestamp = isNaN(createdAt.getTime()) ?
        'Invalid Date' :
        createdAt.toLocaleString('en-US', {
          timeZone: 'America/Chicago',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit'
        });

      return `
        <tr>
          <td>${escapeHtml(pick.username || '(unknown)')}</td>
          <td>${escapeHtml(pick.team)}</td>
          <td class="cell-time">${timestamp}</td>
        </tr>
      `;
    }).join('');

    floatingPicksBody.innerHTML = pickRows ||
      `<tr><td colspan="3" class="table-empty">No picks for Week ${week} yet.</td></tr>`;

    if (prevPickWeekBtn) prevPickWeekBtn.disabled = week <= 1;
    if (nextPickWeekBtn) nextPickWeekBtn.disabled = week >= maxTickerWeek();
  }

  // Let the data loader redraw the ticker once the picks arrive.
  refreshPickTicker = () => renderPickTickerForWeek(currentPickTickerWeek);
  refreshPickTicker();

  if (prevPickWeekBtn) {
    prevPickWeekBtn.addEventListener('click', () => {
      if (currentPickTickerWeek > 1) {
        currentPickTickerWeek--;
        renderPickTickerForWeek(currentPickTickerWeek);
      }
    });
  }

  if (nextPickWeekBtn) {
    nextPickWeekBtn.addEventListener('click', () => {
      if (currentPickTickerWeek < maxTickerWeek()) {
        currentPickTickerWeek++;
        renderPickTickerForWeek(currentPickTickerWeek);
      }
    });
  }

  // Close on escape key
  document.addEventListener('keydown', (e) => {
    const signInModal = document.getElementById('signInModal');
    if (e.key === 'Escape' && signInModal && !signInModal.hidden) {
      closeSignInModal();
    }
  });

  // Removed: window resize listener for autoFitPlayerName no longer needed

  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape') {
      const usernameGate = document.getElementById('usernameGate');
      if(usernameGate && usernameGate.style.display === 'block') {
        usernameGate.style.display = 'none';
        usernameGate.setAttribute('aria-hidden', 'true');
      }
    }
    
    if(e.target.id === 'usernameInput' && e.key === 'Enter') {
      if (btnSaveUsernameEl) {
        btnSaveUsernameEl.click();
      }
    }
    
    if((e.target.id === 'authEmail' || e.target.id === 'authPass') && e.key === 'Enter') {
      if (btnSignInEl) {
        btnSignInEl.click();
      }
    }
  });

  window.addEventListener('ff-auth-changed', async () => {
    await refreshAuthUI();
    await refreshLeagueStats();
  });

  // Modified initialization
  (async function initializeApplication(){
    console.log('Law & Order: Special Victory Unit - Initializing...');
    
    try {
      renderTeams();
      updateStatus();

      await refreshAuthUI();
      await refreshLeagueStats();
      
      console.log(`Application initialized successfully - Week ${gameState.currentWeek}`);
      
    } catch(error) {
      console.error('Application initialization failed:', error);
    }
  })();
});

// FIXED: Added debouncing to prevent rapid auth state cycling
let authRefreshTimeout;

db.auth.onAuthStateChange((event, session) => {
  console.log('Auth state changed:', event);
  
  // Clear any pending refresh
  clearTimeout(authRefreshTimeout);
  
  // Debounce the refresh to avoid rapid cycles
  authRefreshTimeout = setTimeout(() => {
    refreshAuthUI();
  }, 500);
});

async function loadUserPicksAndDisableTeams(){
  if(!currentUser) return;

  try {
    const { data: picks, error } = await db
      .from(PICKS_TABLE)
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: true });

    if(error) {
      console.error('Error loading picks:', error);
      return;
    }

    const activePicks = activePicksFromHistory(picks);
    gameState.usedTeams = activePicks.map(p => p.team);
    gameState.weeklyPicks = picks.slice();

    // Find the latest pick's status
    const latestPick = activePicks.length > 0 ? activePicks[activePicks.length - 1] : null;
    const playerStatusEl = document.getElementById('playerStatus');
    const playerStatusCardEl = document.getElementById('playerStatusCard');

    if (latestPick && latestPick.result && playerStatusEl && playerStatusCardEl) {
      const status = latestPick.result;
      const statusLower = status.toLowerCase();

      // Remove all status classes
      playerStatusCardEl.classList.remove('status-survived', 'status-dun-dun', 'status-pick-is-in');

      // Add appropriate class and display text
      if (statusLower.includes('survived')) {
        playerStatusCardEl.classList.add('status-survived');
        playerStatusEl.textContent = 'SURVIVED';
      } else if (statusLower.includes('dun dun')) {
        playerStatusCardEl.classList.add('status-dun-dun');
        playerStatusEl.textContent = 'DUN DUN';
      } else if (statusLower.includes('pick is in')) {
        playerStatusCardEl.classList.add('status-pick-is-in');
        playerStatusEl.textContent = 'PICK IS IN';
      } else {
        playerStatusEl.textContent = status;
      }
    } else if (playerStatusEl) {
      playerStatusEl.textContent = '-';
      if (playerStatusCardEl) {
        playerStatusCardEl.classList.remove('status-survived', 'status-dun-dun', 'status-pick-is-in');
      }
    }

    const currentWeekPick = activePicks.find(p => Number(p.week) === Number(gameState.currentWeek));
    const alreadyPickedEl = document.getElementById('alreadyPickedMsg');
    const submitPickEl = document.getElementById('submitPick');

    if(currentWeekPick && alreadyPickedEl && submitPickEl) {
      submitPickEl.disabled = true;
      alreadyPickedEl.style.display = 'none';
    } else {
      if (alreadyPickedEl) alreadyPickedEl.style.display = 'none';
    }

    renderTeams();
    updateStatus();

  } catch(error) {
    console.error('Unexpected error loading picks:', error);
  }
}

async function insertPick(row){
  const result = await db.from(PICKS_TABLE).insert(row);

  if(result.error && schedulePickColumnsUnsupported(result.error)){
    return await db
      .from(PICKS_TABLE)
      .insert({
        user_id: row.user_id,
        week: row.week,
        team: row.team,
        username: row.username
      });
  }

  return result;
}

async function submitPick(teamName = gameState.selectedTeam){
  if(!currentUser) {
    alert('Please sign in first, detective.');
    return;
  }
  
  if(!currentProfile) {
    alert('Please choose a username to play.');
    return;
  }
  
  if(!teamName || !gameState.isActive) {
    return;
  }

  const week = gameState.currentWeek;
  const team = teamName;
  const activePicks = currentUserActivePicks();
  const activeCurrentPick = activePicks.find(p => Number(p.week) === Number(week));
  const usedInAnotherWeek = activePicks.find(p => p.team === team && Number(p.week) !== Number(week));
  const scheduleInfo = scheduleInfoForTeam(team);

  if(activeCurrentPick?.team === team){
    alert(`${team} is already your Week ${week} victim.`);
    return;
  }

  if(activeCurrentPick && currentPickLocked()){
    alert(`Week ${week} is locked because ${activeCurrentPick.team} already reached its pick window.`);
    return;
  }

  if(usedInAnotherWeek){
    alert(`${team} was already named in Week ${usedInAnotherWeek.week}.`);
    return;
  }

  if(scheduleInfo.isBye){
    alert(`${team} is on a bye in Week ${week}.`);
    return;
  }

  if(scheduleInfo.locked){
    alert(`Pick window closed for ${team}.`);
    return;
  }

  try {
    const { error } = await insertPick({
      user_id: currentUser.id,
      season: SEASON,
      week: week,
      team: team,
      username: currentProfile.username,
      submitted_at_utc: new Date().toISOString(),
      opponent: scheduleInfo.opponent || null,
      home_away: scheduleInfo.homeAway === 'vs' || scheduleInfo.homeAway === '@' ? scheduleInfo.homeAway : null,
      kickoff_at_utc: scheduleInfo.game?.kickoffUtc || null,
      schedule_source_url: window.NFL_SCHEDULE_HELPERS?.getScheduleUrlForWeek?.(week) || window.NFL_SCHEDULE_SOURCE_URL || null
    });

    if(error) {
      if(error.code === '23505') {
        alert('Freeze!: Either you already named a victim this week, or you already used that victim. Contact KK to change your pick');
      } else {
        alert('Error submitting pick: ' + error.message);
      }
      return;
    }

    gameState.weeklyPicks.push({ week, team, season: SEASON });
    gameState.selectedTeam = null;
    const submitPickEl = document.getElementById('submitPick');
    if (submitPickEl) {
      submitPickEl.disabled = true;
    }

    const verdictEl = document.createElement('div');
    verdictEl.className = 'verdict slide-in';
    verdictEl.innerHTML = `<strong>DA McCoy:</strong> "The people have named ${escapeHtml(team)} as the victim in Week ${week}. Let's see if justice prevails."`;
    const selectionEl = document.getElementById('teamSelection');
    if (selectionEl) selectionEl.appendChild(verdictEl);
    
    setTimeout(() => {
      if(verdictEl.parentNode) {
        verdictEl.remove();
      }
    }, 4500);

    await loadUserPicksAndDisableTeams();
    await refreshLeagueStats();

  } catch(error) {
    console.error('Unexpected error submitting pick:', error);
    alert('An unexpected error occurred while submitting your pick.');
  }
}


function renderTeams(){
  // Absent on the home page since the lineup moved to victims/.
  const teamGridEl = document.getElementById('teamGrid');
  if (!teamGridEl) return;
  teamGridEl.innerHTML = '';

  nflTeams.forEach((team) => {
    const activePicks = currentUserActivePicks();
    const activeCurrentPick = activePicks.find(p => Number(p.week) === Number(gameState.currentWeek));
    const usedPick = activePicks.find(p => p.team === team.name && Number(p.week) !== Number(gameState.currentWeek));
    const scheduleInfo = scheduleInfoForTeam(team.name);
    const isUsed = Boolean(usedPick);
    const isSelected = gameState.selectedTeam === team.name;
    const isCurrentPick = activeCurrentPick?.team === team.name;
    const isUnavailable = currentPickLocked() || isUsed || scheduleInfo.isBye || scheduleInfo.locked || !gameState.isActive;

    // Find the week this team was picked
    const pickedWeek = usedPick?.week || null;

    const cardEl = document.createElement('div');
    cardEl.className = 'team-card';
    cardEl.setAttribute('role', 'button');
    cardEl.setAttribute('tabindex', isUnavailable ? '-1' : '0');
    cardEl.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    cardEl.setAttribute('aria-label', `Name ${team.name} as this week's victim, ${matchupText(scheduleInfo)}${isUsed ? ' (already used)' : ''}`);

    const teamPrimary = team.primary || '#4B5563';
    const teamSecondary = team.secondary || '#E5E7EB';

    // Unpicked teams: team colors with white text
    // Picked teams: gray background with normal text
    if (isUsed || scheduleInfo.isBye || scheduleInfo.locked) {
      cardEl.style.background = 'var(--bg-primary)';
      cardEl.style.color = 'var(--text-primary)';
      cardEl.style.borderLeftColor = teamPrimary;
    } else {
      cardEl.style.background = teamPrimary;
      cardEl.style.color = 'white';
      cardEl.style.borderLeftColor = teamPrimary;
      cardEl.style.borderColor = teamSecondary;
      cardEl.style.textShadow = '1px 1px 2px rgba(0, 0, 0, 0.5)';
    }
    cardEl.style.setProperty('--team-primary', teamPrimary);
    cardEl.style.setProperty('--team-secondary', teamSecondary);

    // Get total picks for this team from global counts
    const totalPicks = globalTeamCounts.get(team.name) || 0;
    const statusLine = isCurrentPick ? 'CURRENT VICTIM' :
      isUsed && pickedWeek ? `NAMED BY YOU WK${pickedWeek}` :
      scheduleInfo.isBye ? 'BYE' :
      scheduleInfo.locked ? 'LOCKED' :
      'STILL BREATHING';

    cardEl.innerHTML = `
      <div class="team-name">
        ${escapeHtml(team.name)}
        <span class="team-matchup-line">${escapeHtml(matchupText(scheduleInfo))}</span>
        <br><span style="font-size:0.8rem;margin-top:4px;opacity:0.8">${escapeHtml(statusLine)}</span>
        <br><span style="font-size:0.75rem;margin-top:4px;opacity:0.7">Named by League ${totalPicks} ${totalPicks === 1 ? 'Time' : 'Times'}</span>
      </div>
    `;

    if(isUnavailable) {
      cardEl.classList.add('disabled');
      cardEl.setAttribute('aria-disabled', 'true');
    } else {
      cardEl.addEventListener('click', () => selectTeam(team.name));
      cardEl.addEventListener('keydown', (e) => {
        if(e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectTeam(team.name);
        }
      });
    }

    if((isSelected || isCurrentPick) && !isUsed) {
      cardEl.classList.add('selected');
    }

    teamGridEl.appendChild(cardEl);
  });
}

function selectTeam(teamName){
  const activePicks = currentUserActivePicks();
  const usedInAnotherWeek = activePicks.some(pick =>
    pick.team === teamName && Number(pick.week) !== Number(gameState.currentWeek)
  );
  const scheduleInfo = scheduleInfoForTeam(teamName);

  if(currentPickLocked() || usedInAnotherWeek || scheduleInfo.isBye || scheduleInfo.locked || !gameState.isActive) {
    return;
  }

  gameState.selectedTeam = teamName;
  renderTeams();
  const submitPickEl = document.getElementById('submitPick');
  if (submitPickEl) {
    submitPickEl.disabled = false;
  }
  
  const announcement = `Picked ${teamName}`;
  const ariaLiveEl = document.createElement('div');
  ariaLiveEl.setAttribute('aria-live', 'polite');
  ariaLiveEl.className = 'sr-only';
  ariaLiveEl.textContent = announcement;
  document.body.appendChild(ariaLiveEl);
  setTimeout(() => ariaLiveEl.remove(), 1000);
}

function updateStatus(){
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  setText('currentWeek', gameState.currentWeek);
  setText('teamsUsedCount', gameState.usedTeams.length);
  setText('teamsRemaining', 32 - gameState.usedTeams.length);

  // Update team selection subtitle with current week
  const subtitleEl = document.getElementById('teamSelectionSubtitle');
  if (subtitleEl) {
    subtitleEl.textContent = `(Pick a team you believe will lose in week ${gameState.currentWeek}):`;
  }

  const seasonEl = document.getElementById('seasonSubtitle');
  if (seasonEl) {
    seasonEl.textContent = 'Special Victory Unit';
  }

  // Removed: playerName element no longer exists
}


function showGameOver(won = false, customMessage = null){
  const gameOverEl = document.getElementById('gameOverSection');
  const messageEl = document.getElementById('gameOverMessage');
  const verdictEl = document.getElementById('finalVerdict');

  if(won) {
    messageEl.textContent = customMessage || 
      `Congratulations! You worked through all 32 victims and made it through ${gameState.currentWeek - 1} weeks!`;
    verdictEl.innerHTML = 
      `<strong>Judge:</strong> "This court finds you NOT GUILTY of poor judgment. Case dismissed with honors!"`;
    verdictEl.style.borderLeftColor = 'var(--success)';
  } else {
    const failedTeam = gameState.selectedTeam || 'Unknown Team';
    messageEl.textContent = customMessage || 
      `Case closed! ${failedTeam} won in Week ${gameState.currentWeek}.`;
    verdictEl.innerHTML = 
      `<strong>Judge:</strong> "The defendant ${failedTeam} has been found NOT GUILTY of losing. Your prosecution has failed. Court adjourned."`;
    verdictEl.style.borderLeftColor = 'var(--error)';
  }

  gameOverEl.style.display = 'block';
  const selectionEl = document.getElementById('teamSelection');
  if (selectionEl) selectionEl.style.display = 'none';
  
  gameOverEl.focus();
}

  async function fetchAllPicksPublic() {
try {
  const { data, error } = await db
    .from(PICKS_TABLE)
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching league picks:', error);
    return [];
  }
  return data || [];
} catch (error) {
  console.error('Unexpected error fetching league data:', error);
  return [];
}
  }
  
  async function refreshLeagueStats() {
const picks = await fetchAllPicksPublic();
// Changing a pick writes a new row rather than overwriting the old one, so the
// raw list can hold several entries for the same player and week. The Pick
// Ticker filters this list directly, so it has to be reduced to the latest
// entry per player per week first or a player who changed their mind shows up
// twice. Everything else already runs activePicksFromHistory on its own copy.
allPicksData = activePicksFromHistory(picks);
if (refreshPickTicker) refreshPickTicker();
// Re-render teams after stats are loaded to show updated pick counts
renderTeams();
  }
