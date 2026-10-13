// ===== CASE DISMISSED WITH HONORS =====
// The banner at the top of the Precinct once the season is decided. Reads
// window.SEASON_WINNER from js/season.js and does nothing while it is null, so
// the markup can stay on the page from one season to the next.
//
// The record is printed in full - every victim, every week - because the
// winner's run is the whole story of the season, and "won" alone would be the
// one fact on the page with no evidence beside it.
(function () {
  const NFL_LOGO_URL = 'https://static.www.nfl.com/league/api/clubs/logos/';

  document.addEventListener('DOMContentLoaded', () => {
    const section = document.getElementById('seasonWinner');
    const winner = window.SEASON_WINNER;
    if (!section || !winner) return;

    const picks = (winner.picks || []).slice().sort((a, b) => a.week - b.week);
    const weeks = picks.length;

    section.innerHTML = `
      <p class="season-winner-kicker">The ${escapeHtml(String(window.SEASON || ''))} season is closed</p>
      <h2 class="season-winner-title" id="seasonWinnerTitle">
        <span class="season-winner-trophy" aria-hidden="true">🏆</span>
        ${escapeHtml(winner.username)}
      </h2>
      <p class="season-winner-line">
        The last suspect standing. ${spell(weeks)} weeks, ${spell(weeks).toLowerCase()} victims,
        ${spell(weeks).toLowerCase()} times SURVIVED. Every other case on the board is closed.
      </p>
      <ol class="season-winner-record">
        ${picks.map(pickHtml).join('')}
      </ol>
      <p class="verdict"><strong>Judge:</strong> "NOT GUILTY of poor judgment. Case dismissed with honors!"</p>`;

    section.hidden = false;

    // A logo that will not load leaves its name, which already says the same
    // thing - the same rule js/victims.js keeps, minus the drawn helmet, since
    // here the name is printed beside it anyway.
    section.querySelectorAll('img').forEach((img) => {
      img.addEventListener('error', () => img.remove(), { once: true });
    });
  });

  function pickHtml(pick) {
    // A top-level const in js/teams.js, so it is a global but not on window.
    const teams = typeof NFL_TEAMS !== 'undefined' ? NFL_TEAMS : [];
    const team = teams.find((entry) => entry.name === pick.team);
    const logo = team?.abbr
      ? `<img class="season-winner-logo" src="${NFL_LOGO_URL}${encodeURIComponent(team.abbr)}.svg" alt="" loading="lazy">`
      : '';

    return `<li class="season-winner-pick">
      <span class="season-winner-week">Wk ${Number(pick.week)}</span>
      ${logo}
      <span class="season-winner-team">${escapeHtml(pick.team)}</span>
      <span class="season-winner-opp">lost to the ${escapeHtml(shortName(pick.opponent))}</span>
    </li>`;
  }

  function shortName(team) {
    return String(team || '').trim().split(/\s+/).pop();
  }

  function spell(n) {
    const words = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight',
      'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
      'Seventeen', 'Eighteen'];
    return words[n] || String(n);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
