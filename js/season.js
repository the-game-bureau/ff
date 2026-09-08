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

// The one handle that gets the admin room, and where the door is. Matched
// exactly, the same comparison js/admin.js:11 makes, so the link never appears
// for someone the admin page would then turn away. Absolute rather than
// relative because the badge sits on pages at two different depths and this
// saves working out a prefix for each.
var ADMIN_USERNAME = 'theclarinetofjustice';
var ADMIN_URL = 'https://thegamebureau.com/ff/admin/index.html';

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

  if(name === ADMIN_USERNAME){
    // Built as a node rather than innerHTML so the name is never parsed as
    // markup, even though this branch only ever runs for a fixed string.
    const link = document.createElement('a');
    link.className = 'week-badge-admin';
    link.href = ADMIN_URL;
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

window.renderHeaderUser = renderHeaderUser;
window.fitHeaderUser = fitHeaderUser;

document.addEventListener('DOMContentLoaded', renderWeekBadge);
