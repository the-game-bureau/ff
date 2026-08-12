const VICTIMS_SUPABASE_URL = 'https://qmaafbncpzrdmqapkkgr.supabase.co';
const VICTIMS_SUPABASE_ANON_KEY = 'sb_publishable_6a9XqxYa0-AZtyrwz4ZeUg_aiMsVH-3';
const VICTIMS_PROFILES_TABLE = 'ff_profiles';
const VICTIMS_PICKS_TABLE = 'ff_picks';

const victimsDb = window.supabase ? window.supabase.createClient(VICTIMS_SUPABASE_URL, VICTIMS_SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    storageKey: 'law-order-svu-auth-qmaafbncpzrdmqapkkgr',
    storage: window.localStorage
  }
}) : null;

const victimState = {
  user: null,
  profile: null,
  pickHistory: [],
  activePicks: [],
  // The week being viewed. Starts from ?week= in the URL, falls back to the
  // open week from season.js.
  week: null
};

const MIN_WEEK = 1;
const MAX_WEEK = 18;

function clampWeek(value){
  const week = Number(value);
  if(!Number.isFinite(week)) return null;
  return Math.min(MAX_WEEK, Math.max(MIN_WEEK, Math.round(week)));
}

function viewWeek(){
  if(victimState.week === null){
    victimState.week = clampWeek(new URLSearchParams(window.location.search).get('week'))
      || clampWeek(window.CURRENT_WEEK)
      || MIN_WEEK;
  }
  return victimState.week;
}

// Keep the address bar in step so a week can be linked to or reloaded.
function setViewWeek(week){
  const next = clampWeek(week);
  if(next === null || next === victimState.week) return;

  victimState.week = next;

  const url = new URL(window.location.href);
  url.searchParams.set('week', String(next));
  window.history.replaceState({}, '', url);

  renderVictims();
}

function renderWeekPicker(){
  const select = document.getElementById('weekSelect');
  if(!select) return;

  if(!select.options.length){
    for(let week = MIN_WEEK; week <= MAX_WEEK; week++){
      const option = document.createElement('option');
      option.value = String(week);
      option.textContent = String(week);
      select.appendChild(option);
    }
    select.addEventListener('change', () => setViewWeek(select.value));
  }

  select.value = String(viewWeek());
  renderScheduleLink();
}

// Signed out, the intro line leads with a Login link; signed in it just states
// the task. The week number stays in a <strong id="victimWeek"> either way.
function renderVictimIntro(){
  const intro = document.getElementById('victimIntro');
  if(!intro) return;

  const tail = `a victim that you believe will lose in week <strong id="victimWeek">${viewWeek()}</strong>.`;
  intro.innerHTML = victimState.user
    ? `Pick ${tail}`
    : `<a class="status-link" href="#signin">Login</a> to pick ${tail}`;
}

// The "View Full Schedule" link follows the week in the dropdown.
function renderScheduleLink(){
  const link = document.getElementById('weekScheduleLink');
  if(!link) return;

  const week = viewWeek();
  link.href = window.NFL_SCHEDULE_HELPERS?.getScheduleUrlForWeek?.(week) ||
    `${window.NFL_SCHEDULE_SOURCE_URL || 'https://plaintextsports.com/nfl/2026/schedule'}#week${week}`;
  link.title = `Week ${week} NFL schedule`;
}

// One generic helmet silhouette, tinted per team. Deliberately not the real
// NFL helmet marks: those are trademarked, and the icon sets that copy them
// are licensed for personal desktop use only, not for a public site.
function helmetSvg(primary, secondary){
  return `
    <svg class="helmet" viewBox="0 0 64 56" role="img" aria-hidden="true">
      <path class="helmet-shell" fill="${primary}"
            d="M10 32 A22 24 0 0 1 54 30 L54 36 Q54 41 49 41 L27 41 Q16 41 13 47 Q10 40 10 32 Z"/>
      <path class="helmet-stripe" fill="none" stroke="${secondary}"
            stroke-width="5" stroke-linecap="round" d="M15 25 Q32 7 50 24"/>
      <circle class="helmet-ear" fill="${secondary}" opacity="0.55" cx="27" cy="30" r="4"/>
      <g class="helmet-mask" fill="none" stroke="${secondary}"
         stroke-width="2.8" stroke-linecap="round">
        <path d="M53 34 Q58 40 53 46 Q49 49 43 49 L34 49"/>
        <path d="M36 41.5 H55"/>
        <path d="M35 46 H54"/>
      </g>
    </svg>`;
}

const LOGO_URL = abbr => `https://static.www.nfl.com/league/api/clubs/logos/${abbr}.svg`;

function splitTeamName(name){
  const cut = name.lastIndexOf(' ');
  return { place: name.slice(0, cut), nickname: name.slice(cut + 1) };
}

const CONFERENCE_ORDER = ['AFC', 'NFC'];
const DIVISION_ORDER = ['East', 'North', 'South', 'West'];

function byConferenceThenDivision(a, b){
  const conf = CONFERENCE_ORDER.indexOf(a.conference) - CONFERENCE_ORDER.indexOf(b.conference);
  if(conf !== 0) return conf;

  const div = DIVISION_ORDER.indexOf(a.division) - DIVISION_ORDER.indexOf(b.division);
  if(div !== 0) return div;

  return a.name.localeCompare(b.name);
}

function escapeHtml(value){
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// The sign-in prompt needs a clickable link, so this accepts markup. Callers
// pass either plain text or one of the trusted constants below.
function setVictimStatus(message, kind){
  const el = document.getElementById('victimPickStatus');
  if(!el) return;

  el.innerHTML = message;
  el.classList.remove('join-status-good', 'join-status-bad');
  if(kind) el.classList.add(`join-status-${kind}`);
}

function pickTimestamp(pick){
  return pick?.submitted_at_utc || pick?.created_at || '1970-01-01T00:00:00Z';
}

function isCurrentSeasonPick(pick){
  return !pick.season || Number(pick.season) === Number(SEASON);
}

function activePicksFromHistory(picks){
  const latestByWeek = new Map();

  for(const pick of (picks || []).filter(isCurrentSeasonPick)){
    const week = Number(pick.week);
    const previous = latestByWeek.get(week);
    if(!previous || new Date(pickTimestamp(pick)) > new Date(pickTimestamp(previous))){
      latestByWeek.set(week, pick);
    }
  }

  return [...latestByWeek.values()].sort((a, b) => Number(a.week) - Number(b.week));
}

function currentWeekPick(){
  return victimState.activePicks.find(pick => Number(pick.week) === Number(viewWeek())) || null;
}

function currentPickLocked(){
  const activePick = currentWeekPick();
  return activePick ? scheduleInfoForTeam(activePick.team).locked : false;
}

function usedInOtherWeek(teamName){
  return victimState.activePicks.find(pick =>
    pick.team === teamName && Number(pick.week) !== Number(viewWeek())
  ) || null;
}

function scheduleInfoForTeam(teamName){
  return window.NFL_SCHEDULE_HELPERS?.getTeamScheduleInfo?.(teamName, viewWeek()) || {
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

  // Spell out the side of the ball: "@" and "vs" alone read as noise on a card.
  const side = info.homeAway === '@' ? 'Away @' : 'Home vs';
  return `${side} ${info.opponentShort || info.opponent}`;
}

function formatLockTime(lockAtUtc){
  if(!lockAtUtc) return 'TBD';
  return new Date(lockAtUtc).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function pickInsertColumnsUnsupported(error){
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

async function fetchVictimProfile(){
  if(!victimsDb || !victimState.user) return null;

  const { data, error } = await victimsDb
    .from(VICTIMS_PROFILES_TABLE)
    .select('username')
    .eq('id', victimState.user.id)
    .maybeSingle();

  if(error && error.code !== 'PGRST116'){
    setVictimStatus(`Profile check failed: ${error.message}`, 'bad');
    return null;
  }

  return data || null;
}

async function fetchVictimPicks(){
  if(!victimsDb || !victimState.user) return [];

  const { data, error } = await victimsDb
    .from(VICTIMS_PICKS_TABLE)
    .select('*')
    .eq('user_id', victimState.user.id)
    .order('created_at', { ascending: true });

  if(error){
    setVictimStatus(`Pick history failed: ${error.message}`, 'bad');
    return [];
  }

  return data || [];
}

async function refreshVictimState(){
  if(!victimsDb){
    setVictimStatus('Booking desk is offline. Refresh and try again.', 'bad');
    return;
  }

  const { data: { user } } = await victimsDb.auth.getUser();
  victimState.user = user || null;
  victimState.profile = user ? await fetchVictimProfile() : null;
  victimState.pickHistory = user ? await fetchVictimPicks() : [];
  victimState.activePicks = activePicksFromHistory(victimState.pickHistory);

  if(!user){
    setVictimStatus('', '');
  } else if(!victimState.profile){
    setVictimStatus('Profile missing. Return to the Precinct and choose a username.', 'bad');
  } else {
    const activePick = currentWeekPick();
    const locked = currentPickLocked();
    setVictimStatus(activePick ?
      `Week ${viewWeek()} victim: ${activePick.team}.${locked ? ' That pick is locked.' : ' Pick another unlocked team to change it.'}` :
      `Week ${viewWeek()} is open. Click a victim to enter it.`,
      'good');
  }
}

function cardStatus(teamName, info){
  const activePick = currentWeekPick();
  const usedPick = usedInOtherWeek(teamName);

  if(activePick?.team === teamName) return 'Current Victim';
  // Burned in an earlier week: one team per season, so it is off the board.
  if(usedPick) return 'Not Available';
  if(info.isBye) return 'Bye';
  if(info.locked) return 'Locked';
  return 'Still Breathing';
}

function isCardDisabled(teamName, info){
  return Boolean(currentPickLocked() || usedInOtherWeek(teamName) || info.isBye || info.locked);
}

function renderVictims(){
  const grid = document.getElementById('victimGrid');
  if(!grid) return;

  const teams = [...NFL_TEAMS].sort(byConferenceThenDivision);
  const activePick = currentWeekPick();

  grid.innerHTML = teams.map(team => {
    const { place, nickname } = splitTeamName(team.name);
    const info = scheduleInfoForTeam(team.name);
    const disabled = isCardDisabled(team.name, info);
    const isActivePick = activePick?.team === team.name;
    const status = cardStatus(team.name, info);
    const ariaLabel = `${team.name}, ${matchupText(info)}, ${status}`;

    return `
    <li class="victim-card${disabled ? ' disabled' : ''}${isActivePick ? ' current-pick' : ''}"
        role="button"
        tabindex="${disabled ? '-1' : '0'}"
        aria-disabled="${disabled ? 'true' : 'false'}"
        aria-pressed="${isActivePick ? 'true' : 'false'}"
        aria-label="${escapeHtml(ariaLabel)}"
        data-team="${escapeHtml(team.name)}"
        data-primary="${team.primary}"
        data-secondary="${team.secondary}">
      <img class="victim-logo" src="${LOGO_URL(team.abbr)}" alt="${team.name} logo"
           width="76" height="76" loading="lazy" />
      <div class="victim-name">
        <span class="victim-place">${escapeHtml(place)}</span>
        <span class="victim-nickname">${escapeHtml(nickname)}</span>
        <span class="victim-matchup-line" title="${escapeHtml(info.line || matchupText(info))}">${escapeHtml(matchupText(info))}</span>
      </div>
      <div class="victim-status">${escapeHtml(status)}</div>
    </li>
  `;
  }).join('');

  grid.querySelectorAll('.victim-card').forEach((card, i) => {
    const team = teams[i];
    const info = scheduleInfoForTeam(team.name);
    const disabled = isCardDisabled(team.name, info);
    card.style.setProperty('--victim-primary', team.primary);
    card.style.setProperty('--victim-secondary', team.secondary);

    const img = card.querySelector('.victim-logo');
    img.addEventListener('error', () => {
      img.insertAdjacentHTML('afterend', helmetSvg(team.primary, team.secondary));
      img.remove();
    }, { once: true });

    if(disabled) return;

    card.addEventListener('click', () => submitVictimPick(team.name));
    card.addEventListener('keydown', (event) => {
      if(event.key === 'Enter' || event.key === ' '){
        event.preventDefault();
        submitVictimPick(team.name);
      }
    });
  });

  renderWeekPicker();

  renderVictimIntro();

  const weekEl = document.getElementById('victimWeek');
  if(weekEl) weekEl.textContent = viewWeek();

  const countEl = document.getElementById('victimCount');
  if(countEl) countEl.textContent = NFL_TEAMS.length;
}

async function insertVictimPick(row){
  const result = await victimsDb.from(VICTIMS_PICKS_TABLE).insert(row);

  if(result.error && pickInsertColumnsUnsupported(result.error)){
    return await victimsDb
      .from(VICTIMS_PICKS_TABLE)
      .insert({
        user_id: row.user_id,
        week: row.week,
        team: row.team,
        username: row.username
      });
  }

  return result;
}

async function submitVictimPick(teamName){
  if(!victimState.user){
    setVictimStatus('<a class="status-link" href="#signin">Login</a> to pick.', 'bad');
    return;
  }

  if(!victimState.profile){
    setVictimStatus('Profile missing. Return to the Precinct and choose a username.', 'bad');
    return;
  }

  const activePick = currentWeekPick();
  if(activePick?.team === teamName){
    setVictimStatus(`${teamName} is already your Week ${viewWeek()} victim.`, 'good');
    return;
  }

  if(activePick && currentPickLocked()){
    setVictimStatus(`Week ${viewWeek()} is locked because ${activePick.team} already reached its pick window.`, 'bad');
    return;
  }

  const usedPick = usedInOtherWeek(teamName);
  if(usedPick){
    setVictimStatus(`${teamName} was already named in Week ${usedPick.week}.`, 'bad');
    return;
  }

  const info = scheduleInfoForTeam(teamName);
  if(info.isBye){
    setVictimStatus(`${teamName} is on a bye in Week ${viewWeek()}.`, 'bad');
    return;
  }

  if(info.locked){
    setVictimStatus(`${teamName} locked at ${formatLockTime(info.lockAtUtc)} Central.`, 'bad');
    return;
  }

  const submittedAtUtc = new Date().toISOString();
  const row = {
    user_id: victimState.user.id,
    season: SEASON,
    week: viewWeek(),
    team: teamName,
    username: victimState.profile.username,
    submitted_at_utc: submittedAtUtc,
    opponent: info.opponent || null,
    home_away: info.homeAway === 'vs' || info.homeAway === '@' ? info.homeAway : null,
    kickoff_at_utc: info.game?.kickoffUtc || null,
    schedule_source_url: window.NFL_SCHEDULE_HELPERS?.getScheduleUrlForWeek?.(viewWeek()) || window.NFL_SCHEDULE_SOURCE_URL || null
  };

  setVictimStatus(`Saving Week ${viewWeek()} victim...`, '');

  try {
    const { error } = await insertVictimPick(row);

    if(error){
      setVictimStatus(`Pick save failed: ${error.message}`, 'bad');
      return;
    }

    setVictimStatus(`Week ${viewWeek()} victim saved: ${teamName} ${matchupText(info)}.`, 'good');
    await refreshVictimState();
    renderVictims();
  } catch(error) {
    console.error('Victim pick error:', error);
    setVictimStatus('Unexpected pick save failure.', 'bad');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  renderVictims();
  await refreshVictimState();
  renderVictims();
});

window.addEventListener('ff-auth-changed', async () => {
  await refreshVictimState();
  renderVictims();
});

let victimAuthRefreshTimeout;
if(victimsDb){
  victimsDb.auth.onAuthStateChange(() => {
    window.clearTimeout(victimAuthRefreshTimeout);
    victimAuthRefreshTimeout = window.setTimeout(async () => {
      await refreshVictimState();
      renderVictims();
    }, 300);
  });
}
