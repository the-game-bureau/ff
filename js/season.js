// ===== SEASON DIAL =====
// The generated Plain Text Sports schedule drives the open week when present.
// Fall back to Week 1 if a page is opened without the schedule file.
var SEASON = window.NFL_SCHEDULE_SEASON || 2026;
var CURRENT_WEEK = window.NFL_SCHEDULE_HELPERS?.getCurrentWeek?.() || 1;

window.SEASON = SEASON;
window.CURRENT_WEEK = CURRENT_WEEK;

function renderWeekBadge(){
  const el = document.getElementById('weekBadge');
  if(!el) return;

  // Three cells in one frame: week and season side by side, the signed-in
  // handle across the full width beneath them. The third cell carries its own
  // top rule, so while signed out the badge is simply the two-square block it
  // has always been. Display only, not a link.
  el.innerHTML =
    '<span class="week-badge-row">' +
      `<span class="week-badge-week">Week ${CURRENT_WEEK}</span>` +
      `<span class="week-badge-season">${SEASON}</span>` +
    '</span>' +
    '<span class="week-badge-user" id="headerUser" aria-live="polite" hidden></span>';
}

// The handle takes the width of the two boxes above it and gives up type size
// to fit, rather than widening the block and breaking the square stack. Called
// by whichever auth module owns the page after it sets the name.
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

window.fitHeaderUser = fitHeaderUser;

document.addEventListener('DOMContentLoaded', renderWeekBadge);
