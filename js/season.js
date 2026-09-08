// ===== SEASON DIAL =====
// The generated Plain Text Sports schedule drives the open week when present.
// Fall back to Week 1 if a page is opened without the schedule file.
var SEASON = window.NFL_SCHEDULE_SEASON || 2026;
var CURRENT_WEEK = window.NFL_SCHEDULE_HELPERS?.getCurrentWeek?.() || 1;

// How many minutes before kickoff a team stops being pickable. A house rule,
// so it lives here rather than in the generated schedule file, which would lose
// it the next time that file is regenerated. js/nfl-schedule.js reads this at
// call time, not at load time, which is what lets it sit in the file that loads
// second. The server enforces the same number — see
// supabase/sql/ff_pick_lock_minutes.sql — so changing it here alone only makes
// the browser stricter, never looser.
var PICK_LOCK_MINUTES = 5;

// The one handle that gets the admin room, and where the door is. Compared
// case-insensitively, which is what js/admin.js does before its own check, so
// the link appears exactly when the admin page would let you in — the stored
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

function renderWeekBadge(){
  const el = document.getElementById('weekBadge');
  if(!el) return;

  // Three cells in one frame: week and season side by side, the signed-in
  // handle across the full width beneath them. The third cell carries its own
  // top rule, so while signed out the badge is simply the two-square block it
  // has always been. Display only, except for the one handle that gets a link
  // to the admin room — see renderHeaderUser below.
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
// Both auth modules call this rather than writing the cell themselves —
// js/auth-corner.js on most pages, js/app.js on the Precinct — so the two can
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

window.fillPickLockMinutes = fillPickLockMinutes;
window.renderHeaderUser = renderHeaderUser;
window.fitHeaderUser = fitHeaderUser;

document.addEventListener('DOMContentLoaded', () => {
  renderWeekBadge();
  fillPickLockMinutes();
});
