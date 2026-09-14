// ===== SEASON DIAL =====
// The generated Plain Text Sports schedule drives the open week when present.
// Fall back to Week 1 if a page is opened without the schedule file.
var SEASON = window.NFL_SCHEDULE_SEASON || 2026;

// PROVISIONAL. The schedule alone says the week rolls when the last game of it
// kicks off, which is not the league's rule - a week is over when the picks
// that count have been answered, not when the last ball is in the air. The real
// answer needs the picks and lives in the database; see ffOpenWeekReady below
// and supabase/sql/ff_open_week.sql.
//
// This one is still computed, and still first, because something has to be here
// before the network answers and "undefined" is worse than "close". It is right
// except in the hours around a roll.
var CURRENT_WEEK = window.NFL_SCHEDULE_HELPERS?.getCurrentWeek?.() || 1;

// How many minutes before kickoff a team stops being pickable. A house rule,
// so it lives here rather than in the generated schedule file, which would lose
// it the next time that file is regenerated. js/nfl-schedule.js reads this at
// call time, not at load time, which is what lets it sit in the file that loads
// second. The server enforces the same number - see
// supabase/sql/ff_pick_lock_minutes.sql - so changing it here alone only makes
// the browser stricter, never looser.
var PICK_LOCK_MINUTES = 5;

// The one handle that gets the admin room, and where the door is. Compared
// case-insensitively, which is what js/admin.js does before its own check, so
// the link appears exactly when the admin page would let you in - the stored
// handle is mixed case, and the badge's text-transform hides that.
var ADMIN_USERNAME = 'theclarinetofjustice';
var ADMIN_PATH = 'admin/index.html';

// The badge sits on pages nought, one and two levels deep, so the path to the
// admin room is not the same from each. Every page already declares its own
// depth on #siteNav for js/nav.js and js/auth-corner.js to read; this reads
// the same attribute rather than inventing a second way to know.
function adminUrl(){
  const prefix = document.getElementById('siteNav')?.dataset.prefix || '';
  return prefix + ADMIN_PATH;
}

window.SEASON = SEASON;
window.CURRENT_WEEK = CURRENT_WEEK;
window.PICK_LOCK_MINUTES = PICK_LOCK_MINUTES;

// ===== THE OPEN WEEK, FROM THE LEAGUE =====
// _2026_open_week() knows what the schedule cannot: who is still in it, what
// they filed, and which of it has been answered. One definition, shared with
// the auto-scorer, so the two can never disagree about which week is being
// played - see supabase/sql/ff_open_week.sql.
//
// A PROMISE, NOT A VALUE. Every module that decides anything from CURRENT_WEEK
// already does an async fetch of its own before it renders, so each awaits this
// at the top of that fetch and the extra round trip costs nothing. Reading
// CURRENT_WEEK without awaiting is still safe; it is just the provisional
// answer above.
//
// PLAIN FETCH, NO CLIENT. This file loads before js/auth-corner.js, so
// window.ffAuthClient does not exist yet, and standing up a second GoTrue on
// the same storage key to ask one question is the race CLAUDE.md warns about.
// The function is granted to anon and takes no arguments, so the publishable
// key and a POST are the whole of it.
//
// EVERY FAILURE KEEPS THE PROVISIONAL WEEK. Offline, the function not deployed
// yet, a bad response: the page carries on with the schedule's answer rather
// than breaking. That is what makes it safe to ship this before the SQL is run.
async function fetchOpenWeek(){
  try {
    const config = window.FF_SUPABASE_CONFIG;
    if(!config?.url || !config?.publishableKey) return CURRENT_WEEK;

    const response = await fetch(`${config.url}/rest/v1/rpc/_2026_open_week`, {
      method: 'POST',
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${config.publishableKey}`,
        'Content-Type': 'application/json'
      },
      body: '{}'
    });
    if(!response.ok) return CURRENT_WEEK;

    const week = Number(await response.json());
    if(!Number.isInteger(week) || week < 1 || week > 18) return CURRENT_WEEK;

    CURRENT_WEEK = week;
    window.CURRENT_WEEK = week;
    renderWeekBadge();
    return week;
  } catch (error) {
    console.warn('Open week: falling back to the schedule.', error);
    return CURRENT_WEEK;
  }
}

window.ffOpenWeekReady = fetchOpenWeek();

// ASK AGAIN. The promise above settles once, which is right for page load and
// wrong for the one thing that changes the answer while you are looking at it:
// scoring a week writes the verdicts the rule is made of, so the week that was
// open a second ago may not be. js/admin-score.js announces both in this tab
// and, through localStorage, in every other one.
//
// The promise is replaced rather than mutated, so anything that awaits
// ffOpenWeekReady after this gets the fresh answer.
function refreshOpenWeek(){
  window.ffOpenWeekReady = fetchOpenWeek();
  return window.ffOpenWeekReady;
}

window.ffRefreshOpenWeek = refreshOpenWeek;
window.addEventListener('ff-week-scored', refreshOpenWeek);
window.addEventListener('storage', (event) => {
  if(event.key === 'ff-week-scored-at') refreshOpenWeek();
});

// ===== THE ROSTER CLOSES =====
// Five minutes after the last game of Week 1 kicks off, the suspect list is
// final for the season. The same instant the week-1 pick window shuts, which is
// not a coincidence: anybody who has not filed by then has not played week one,
// and a survivor pool somebody joins in week four is a different game from the
// one everybody else entered.
//
// Schedule-derived, like everything else about time here - nothing to set, and
// no stored flag to go stale. PICK_LOCK_MINUTES rather than a typed 5, so the
// deadline moves with the rule it belongs to.
function rosterLockAt(){
  const kickoffs = (window.NFL_SCHEDULE_HELPERS?.getWeekGames?.(1) || [])
    .map((game) => game.kickoffUtc)
    .filter(Boolean)
    .map((stamp) => new Date(stamp).getTime())
    .filter((time) => Number.isFinite(time));

  if(!kickoffs.length) return null;
  return new Date(Math.max(...kickoffs) + PICK_LOCK_MINUTES * 60 * 1000);
}

// No schedule, no deadline, and the roster stays open - the safe direction for
// a page that could not read the fixtures. Turning people away is the thing
// worth being sure about.
function rosterLocked(){
  const at = rosterLockAt();
  return Boolean(at) && Date.now() >= at.getTime();
}

window.ffRosterLockAt = rosterLockAt;
window.ffRosterLocked = rosterLocked;

function renderWeekBadge(){
  const el = document.getElementById('weekBadge');
  if(!el) return;

  // Three cells in one frame: week and season side by side, the signed-in
  // handle across the full width beneath them. The third cell carries its own
  // top rule, so while signed out the badge is simply the two-square block it
  // has always been. Display only, except for the one handle that gets a link
  // to the admin room - see renderHeaderUser below.
  el.innerHTML =
    '<span class="week-badge-row">' +
      `<span class="week-badge-week">Week ${CURRENT_WEEK}</span>` +
      `<span class="week-badge-season">${SEASON}</span>` +
    '</span>' +
    '<span class="week-badge-user" id="headerUser" aria-live="polite" hidden></span>';
}

// Puts the signed-in handle in the badge, and for the admin makes it the way
// into the admin room. Nobody else's page carries the link at all.
//
// Both auth modules call this rather than writing the cell themselves -
// js/auth-corner.js on most pages, js/app.js on the Precinct - so the two can
// never drift on what the badge shows.
//
// This is a shortcut, not a gate: the admin page checks the username itself and
// its RPCs are guarded server-side by ff_is_admin(), so the URL being guessable
// costs nothing.
function renderHeaderUser(username){
  const el = document.getElementById('headerUser');
  if(!el) return;

  const name = String(username || '').trim();
  el.hidden = !name;

  if(!name){
    el.textContent = '';
    return;
  }

  if(name.toLowerCase() === ADMIN_USERNAME){
    // Built as a node rather than innerHTML so the name is never parsed as
    // markup, even though this branch only ever runs for a fixed string.
    const link = document.createElement('a');
    link.className = 'week-badge-admin';
    link.href = adminUrl();
    link.textContent = name;
    link.title = 'Admin';
    el.replaceChildren(link);
  } else {
    el.textContent = name;
  }

  // Sized after the text lands, never before.
  fitHeaderUser();
}

// The handle takes the width of the two boxes above it and gives up type size
// to fit, rather than widening the block and breaking the square stack. Called
// by renderHeaderUser once the name is in place.
function fitHeaderUser(){
  const el = document.getElementById('headerUser');
  if(!el || el.hidden || !el.textContent) return;

  // The cell's width comes from CSS (pinned to the row above); this only has
  // to find the largest type size that fits inside it.
  const MAX_PX = 13;
  const MIN_PX = 7;
  for(let size = MAX_PX; size >= MIN_PX; size -= 0.5){
    el.style.fontSize = `${size}px`;
    if(el.scrollWidth <= el.clientWidth) break;
  }
}

// The pick lock stated in prose. law/index.html spells the rule out in words
// and the APB emails quote the same number; both have to agree with what the
// browser and the server actually enforce, so the figure is filled in from
// PICK_LOCK_MINUTES rather than typed into the page. The markup carries the
// current value as its text, so the rule still reads correctly with the script
// blocked.
function fillPickLockMinutes(){
  for(const el of document.querySelectorAll('[data-pick-lock]')){
    el.textContent = PICK_LOCK_MINUTES;
  }
}

// ===== SAYING WHEN =====
// "friday, september 11th 9:32 am central". Every time this site quotes a
// moment to a reader it is quoted in Central, the zone the kickoffs are given
// in, so two times on one page can never be an hour apart for no visible
// reason. Written once here because the wire on the Precinct and the scoring
// panel on the admin screen both say it, and two copies of a date format is two
// formats the first time either is touched.
function longWhen(value){
  const at = value instanceof Date ? value : new Date(value);
  if(!at || Number.isNaN(at.getTime())) return '';

  const zone = { timeZone: 'America/Chicago' };
  const part = (options) => new Intl.DateTimeFormat('en-US', { ...zone, ...options }).format(at);

  const day = Number(part({ day: 'numeric' }));
  const time = part({ hour: 'numeric', minute: '2-digit' }).toLowerCase();

  return `${part({ weekday: 'long' })}, ${part({ month: 'long' })} ` +
    `${day}${ordinalDay(day)} ${time} central`;
}

// 1st, 2nd, 3rd, 4th - and 11th, 12th, 13th, which break the pattern and are
// the whole reason this is not a lookup on the last digit alone.
function ordinalDay(day){
  const teens = day % 100;
  if(teens >= 11 && teens <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][day % 10] || 'th';
}

window.ffLongWhen = longWhen;
window.fillPickLockMinutes = fillPickLockMinutes;
window.renderHeaderUser = renderHeaderUser;
window.fitHeaderUser = fitHeaderUser;

document.addEventListener('DOMContentLoaded', () => {
  renderWeekBadge();
  fillPickLockMinutes();
});
