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

  // Display only, not a link — the schedule lives on the LINEUP nav button.
  el.innerHTML =
    `<span class="week-badge-week">Week ${CURRENT_WEEK}</span>` +
    `<span class="week-badge-season">${SEASON}</span>`;
}

document.addEventListener('DOMContentLoaded', renderWeekBadge);
