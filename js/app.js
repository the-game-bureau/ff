const FF_CONFIG = window.FF_SUPABASE_CONFIG || {};
const SUPABASE_URL = FF_CONFIG.url || 'https://vkoczgzizzppdrpvpemh.supabase.co';
const SUPABASE_ANON_KEY = FF_CONFIG.publishableKey || 'sb_publishable_XfvD3zCvnCHT1v_EGE-LJA_3Z9bGjKw';
const PROFILES_TABLE = FF_CONFIG.tables?.profiles || 'ff_profiles';
const PICKS_TABLE = FF_CONFIG.tables?.picks || 'ff_picks';

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

// ===== AUTH LIVES IN js/auth-corner.js NOW =====
// This file used to carry a second copy of the whole thing: its own sign-in
// popup, its own sign-in and reset and sign-out handlers, its own header
// painter, its own username gate. auth-corner.js carried the twin for every
// other page, and the two drifted - the same bug had to be fixed twice, in two
// files, on one afternoon, and a rule changed in one was simply wrong in the
// other.
//
// So auth-corner.js owns signing in everywhere, js/username-gate.js owns the
// no-profile case everywhere, and this file keeps only what it needs: who is
// signed in, so a pick can be attributed. It is told by the ff-auth-changed
// event auth-corner broadcasts.
async function refreshAuthUI(){
  try {
    const { data: { user } } = await db.auth.getUser();
    currentUser = user || null;

    if(!currentUser){
      currentProfile = null;
      const submitPickEl = document.getElementById('submitPick');
      if (submitPickEl) submitPickEl.disabled = true;
      updateStatus();
      return;
    }

    // One column, not "*": a select of every column fails outright over a
    // single field this role is not granted, and drags the email address down
    // to the browser for nothing.
    const { data: profile, error } = await db
      .from(PROFILES_TABLE)
      .select('username')
      .eq('id', currentUser.id)
      .maybeSingle();

    // PGRST116 is "no rows", which is js/username-gate.js's business rather
    // than this file's. Anything else is logged and not shown: this runs on
    // every auth refresh in the background, and a dropped connection is not
    // worth interrupting somebody reading the standings.
    if(error && error.code !== 'PGRST116') {
      console.error('Profile fetch failed:', error);
      return;
    }

    currentProfile = profile || null;
    if(currentProfile) await loadUserPicksAndDisableTeams();
    else updateStatus();
  } catch(error) {
    console.error('Auth refresh failed:', error);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const submitPickEl = document.getElementById('submitPick');

  if (submitPickEl) {
    submitPickEl.addEventListener('click', submitPick);
  }

  // Pick Ticker - an inline section on the page now, not a floating panel.
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
