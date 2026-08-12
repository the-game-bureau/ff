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
// One line above the grid, in one of three states: signed out, signed in with
// nothing picked, or signed in with a victim named. It used to say "Pick a
// victim..." while a second line underneath separately announced the current
// pick, which left the instruction contradicting the answer directly below it.
function renderVictimIntro(){
  const intro = document.getElementById('victimIntro');
  if(!intro) return;

  const week = `week <strong id="victimWeek">${viewWeek()}</strong>`;
  const tail = `a victim that you believe will lose in ${week}.`;

  if(!victimState.user){
    intro.innerHTML = `<a class="status-link" href="#signin">Login</a> to pick ${tail}`;
    return;
  }

  const activePick = currentWeekPick();
  if(!activePick){
    intro.innerHTML = `Pick ${tail}`;
    return;
  }

  const change = currentPickLocked()
    ? 'That pick is locked.'
    : 'Pick another available team to change it.';
  intro.innerHTML =
    `Your ${week} victim: <strong>${escapeHtml(activePick.team)}</strong>. ${change}`;
}

// The "View Full NFL Schedule" link follows the week in the dropdown.
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

// How a week gets un-picked. Nothing is ever deleted from ff_picks — the newest
// row for a week is the pick — so releasing a team is a new row for that week
// carrying this marker. Everything downstream reads a skipped latest row as
// "that week has no victim", which is what frees the team up for another week.
// js/app.js carries the same pair; keep them in step.
const PICK_SKIP_RESULT = 'SKIP';

function isSkippedPick(pick){
  return String(pick?.result || '').trim().toUpperCase() === PICK_SKIP_RESULT;
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

  // Filter after choosing the latest row, not before: a skip has to be able to
  // outrank the pick it releases, which it only does by being the newest row.
  return [...latestByWeek.values()]
    .filter(pick => !isSkippedPick(pick))
    .sort((a, b) => Number(a.week) - Number(b.week));
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

// A team named in a week further down the schedule. Unlike a team burned in an
// earlier week, this one can still be taken back: nothing has been played, so
// the later week is released and the team moves to the week being viewed.
function usedInLaterWeek(teamName){
  const usedPick = usedInOtherWeek(teamName);
  return usedPick && Number(usedPick.week) > Number(viewWeek()) ? usedPick : null;
}

// ...unless that later week's game has already kicked off, which happens when
// you are looking back at an earlier week mid-season. Then the pick stands and
// the team is spent, exactly like an earlier-week one.
function reclaimableLaterPick(teamName){
  const laterPick = usedInLaterWeek(teamName);
  if(!laterPick) return null;
  return scheduleInfoForTeamWeek(teamName, laterPick.week).locked ? null : laterPick;
}

function spentInOtherWeek(teamName){
  const usedPick = usedInOtherWeek(teamName);
  if(!usedPick) return null;
  return reclaimableLaterPick(teamName) ? null : usedPick;
}

// Weeks are filled in order: you cannot name a Week 5 victim without having
// named one in Week 4. Returns the earliest unfilled week before the one being
// viewed, or 0 if there is no gap. Week 1 has nothing before it, so it is
// always open.
function firstMissingWeekBefore(){
  const target = Number(viewWeek());

  for(let week = 1; week < target; week++){
    const filled = victimState.activePicks.some(pick => Number(pick.week) === week);
    if(!filled) return week;
  }

  return 0;
}

function scheduleInfoForTeam(teamName){
  return scheduleInfoForTeamWeek(teamName, viewWeek());
}

// Same lookup for any week, not just the one on screen: releasing a later
// week's pick has to check that week's kickoff, not this one's.
function scheduleInfoForTeamWeek(teamName, week){
  return window.NFL_SCHEDULE_HELPERS?.getTeamScheduleInfo?.(teamName, Number(week)) || {
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
    const missingWeek = firstMissingWeekBefore();

    if(missingWeek && !activePick){
      // Say which week and how to get there, rather than leaving a grid of
      // dead cards with no explanation.
      setVictimStatus(
        `Week ${missingWeek} has no victim yet. Weeks are filed in order, so ` +
        `<a class="status-link" href="victims.html?week=${missingWeek}">name a Week ${missingWeek} victim</a> ` +
        `before Week ${viewWeek()}.`,
        'bad'
      );
    } else {
      // The intro line above the grid now carries both the instruction and the
      // current pick, so there is nothing left for this line to say. It stays
      // for what it is actually for: blockers and failures.
      setVictimStatus('', '');
    }
  }

  renderVictimIntro();
}

// Only the two states about this player's own picks get a colour. The rest —
// bye, kickoff passed, earlier week first — are facts about the schedule and
// stay neutral, so the colour means "you did this", not "blocked".
function statusModifier(status){
  if(status === 'Your Current Selection') return ' victim-status-current';
  if(status === 'Previous Selection') return ' victim-status-previous';
  // Yellow, the site's interaction colour: this one is still yours to take.
  if(status === 'Future Selection') return ' victim-status-future';
  return '';
}

function cardStatus(teamName, info){
  const activePick = currentWeekPick();
  const usedPick = usedInOtherWeek(teamName);

  if(activePick?.team === teamName) return 'Your Current Selection';
  // Burned in an earlier week: one team per season, so it is off the board.
  // isCardDisabled() covers this too, so the card is unclickable as well.
  if(usedPick && Number(usedPick.week) < Number(viewWeek())) return 'Previous Selection';

  // Everything that closes this card comes before Future Selection, because the
  // badge has to name the reason you cannot click. A team parked in Week 12 and
  // on a bye in Week 8 is not takeable in Week 8, and reading "Future Selection"
  // on a dead card just looks broken. The tooltip still says where it is parked.
  //
  // An unfilled earlier week closes the whole board, so it outranks the
  // per-team reasons: the gap is why you cannot pick, not the schedule.
  const missingWeek = firstMissingWeekBefore();
  if(missingWeek) return `Week ${missingWeek} First`;
  if(info.isBye) return 'Not Playing';
  if(info.locked) return 'Past Kickoff';

  // Named further down the schedule, and this week is otherwise open — so it
  // really is takeable, and taking it releases the later week.
  if(usedPick) return 'Future Selection';
  return 'Available';
}

// Which week the badge is talking about. "Previous Selection" and "Future
// Selection" both mean "you already named this team somewhere else" without
// ever saying where, and the tooltip that does say only exists on a mouse. So
// the badge alternates: the label fades out, "Week N" fades in, and back. The
// swap is pure CSS (see .victim-status-face) — this only supplies the number.
function cardStatusWeek(status, teamName){
  if(status !== 'Previous Selection' && status !== 'Future Selection') return '';
  const usedPick = usedInOtherWeek(teamName);
  return usedPick ? `Week ${usedPick.week}` : '';
}

// The badge has room for two words, and "Future Selection" does not say which
// week or what happens when you click it. That goes in the tooltip and the
// screen-reader label instead, where there is room for a sentence.
function cardHint(teamName){
  const laterPick = usedInLaterWeek(teamName);
  if(!laterPick) return '';

  return reclaimableLaterPick(teamName)
    ? `Your Week ${laterPick.week} victim. Picking here clears Week ${laterPick.week}.`
    : `Locked into Week ${laterPick.week} — that game has already started.`;
}

function isCardDisabled(teamName, info){
  return Boolean(
    firstMissingWeekBefore() ||
    currentPickLocked() ||
    // Not usedInOtherWeek(): a later week that has not kicked off yet is still
    // reclaimable, so those cards stay live.
    spentInOtherWeek(teamName) ||
    info.isBye ||
    info.locked
  );
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
    const statusWeek = cardStatusWeek(status, team.name);
    const hint = cardHint(team.name);
    const ariaLabel = `${team.name}, ${matchupText(info)}, ${status}${statusWeek ? `, ${statusWeek}` : ''}${hint ? `. ${hint}` : ''}`;

    // Both faces are in the flow of one grid cell, stacked, so the badge sizes
    // to the wider of the two and nothing shifts as they cross-fade. The card's
    // aria-label already carries both, so neither face is read out.
    const statusFaces = statusWeek
      ? `<span class="victim-status-face" aria-hidden="true">${escapeHtml(status)}</span>
         <span class="victim-status-face victim-status-face-alt" aria-hidden="true">${escapeHtml(statusWeek)}</span>`
      : escapeHtml(status);

    return `
    <li class="victim-card${disabled ? ' disabled' : ''}${isActivePick ? ' current-pick' : ''}"
        role="button"
        tabindex="${disabled ? '-1' : '0'}"
        aria-disabled="${disabled ? 'true' : 'false'}"
        aria-pressed="${isActivePick ? 'true' : 'false'}"
        aria-label="${escapeHtml(ariaLabel)}"
        ${hint ? `title="${escapeHtml(hint)}"` : ''}
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
      <div class="victim-status${statusModifier(status)}${statusWeek ? ' victim-status-swap' : ''}">${statusFaces}</div>
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
        username: row.username,
        // Load-bearing on the retry: without it a skip row comes back as an
        // ordinary pick and the week it was meant to release stays taken.
        // `result` predates every column this fallback exists for, so it is
        // always safe to send.
        ...(row.result ? { result: row.result } : {})
      });
  }

  return result;
}

// Release a later week: a new row for that week carrying the skip marker, which
// becomes the newest row and so replaces the pick. The row keeps the team it is
// releasing, because the schedule trigger only accepts a team that actually
// plays that week.
async function releaseLaterPick(pick){
  const week = Number(pick.week);
  const info = scheduleInfoForTeamWeek(pick.team, week);

  return await insertVictimPick({
    user_id: victimState.user.id,
    season: SEASON,
    week,
    team: pick.team,
    username: victimState.profile.username,
    result: PICK_SKIP_RESULT,
    submitted_at_utc: new Date().toISOString(),
    opponent: info.opponent || null,
    home_away: info.homeAway === 'vs' || info.homeAway === '@' ? info.homeAway : null,
    kickoff_at_utc: info.game?.kickoffUtc || null,
    schedule_source_url: window.NFL_SCHEDULE_HELPERS?.getScheduleUrlForWeek?.(week) ||
      window.NFL_SCHEDULE_SOURCE_URL || null
  });
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

  // A later week that has not kicked off is a swap, not a rejection; anything
  // else already spent is final.
  const spentPick = spentInOtherWeek(teamName);
  if(spentPick){
    const laterPick = usedInLaterWeek(teamName);
    setVictimStatus(
      laterPick
        ? `${teamName} is locked into Week ${laterPick.week} — that game has already started.`
        : `${teamName} was already named in Week ${spentPick.week}.`,
      'bad'
    );
    return;
  }

  const missingWeek = firstMissingWeekBefore();
  if(missingWeek){
    setVictimStatus(
      `Name a Week ${missingWeek} victim first. Weeks are filed in order.`,
      'bad'
    );
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

  const releasePick = reclaimableLaterPick(teamName);

  setVictimStatus(`Saving Week ${viewWeek()} victim...`, '');

  try {
    // Release first, then claim. The other order fails: the schedule trigger
    // refuses a team that is still the latest pick in another week.
    if(releasePick){
      const released = await releaseLaterPick(releasePick);
      if(released.error){
        setVictimStatus(
          `Could not clear ${teamName} from Week ${releasePick.week}: ${released.error.message}`,
          'bad'
        );
        return;
      }
    }

    const { error } = await insertVictimPick(row);

    if(error){
      // Redraw before reporting, not after: refreshVictimState() writes its own
      // status line, so it would overwrite this one.
      if(releasePick){
        await refreshVictimState();
        renderVictims();
      }
      // Say so if the release already went through, otherwise that week looks
      // to have emptied itself.
      setVictimStatus(
        releasePick
          ? `Pick save failed: ${error.message} Week ${releasePick.week} was ` +
            `cleared, so it needs a victim again.`
          : `Pick save failed: ${error.message}`,
        'bad'
      );
      return;
    }

    await refreshVictimState();
    renderVictims();
    // After the redraw, for the same reason as the failure branch above: the
    // refresh writes its own status line and would clear this one.
    setVictimStatus(
      releasePick
        ? `Week ${viewWeek()} victim saved: ${teamName} ${matchupText(info)}. ` +
          `Week ${releasePick.week} is open again.`
        : `Week ${viewWeek()} victim saved: ${teamName} ${matchupText(info)}.`,
      'good'
    );
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
