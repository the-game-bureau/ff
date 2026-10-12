// ===== PICK HISTORY =====
// Every row in the picks table, laid out suspect by week, with nothing
// collapsed. Every other reader on the site funnels the table through
// activePicksFromHistory() and shows only the newest row for a (user, week);
// this one deliberately does not, because the question it answers is "what did
// they file, and did they change it".
//
// Inside a cell the rows run oldest first. The last one is the pick that
// stands; everything above it was superseded and is struck through. A SKIP row
// is a released week (see "Releasing a week" in CLAUDE.md) and is shown as
// such, with the team it gave back - a cell whose last row is a SKIP has no
// pick standing at all.
//
// Reads _2026_picks directly, not _2026_active_picks: the view would hide
// exactly the rows this panel exists to show.
(function () {
  const PICKS_CONFIG = window.FF_SUPABASE_CONFIG || {};
  const PICKS_TABLE = PICKS_CONFIG.tables?.picks || 'ff_picks';
  const SUSPECTS_VIEW = PICKS_CONFIG.views?.currentSuspects || 'ff_current_suspects';

  const els = {};

  // The session client from js/auth-corner.js; a second GoTrue instance on one
  // storage key races the first.
  const picksDb = window.ffAuthClient?.auth ? window.ffAuthClient : null;

  const ABBR = new Map(
    (typeof NFL_TEAMS !== 'undefined' ? NFL_TEAMS : []).map((team) => [team.name.toLowerCase(), team.abbr])
  );

  document.addEventListener('DOMContentLoaded', () => {
    els.body = document.getElementById('adminPicksBody');
    els.head = document.getElementById('adminPicksHead');
    els.note = document.getElementById('adminPicksNote');
    if (!els.body) return;

    document.getElementById('btnRefreshPicks')?.addEventListener('click', load);
    window.addEventListener('ff-week-scored', load);
  });

  function result(row) {
    return String(row?.result || '').trim().toUpperCase();
  }

  function abbr(team) {
    const name = String(team || '').trim();
    return ABBR.get(name.toLowerCase()) || name || '?';
  }

  function stamp(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, {
      month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  }

  function fullStamp(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
  }

  async function load() {
    await window.ffOpenWeekReady;

    if (!picksDb) {
      setMessage('Signed out: no session to read the picks with.');
      return;
    }

    setMessage('Reading every pick...');

    const [suspects, picks] = await Promise.all([
      picksDb.from(SUSPECTS_VIEW).select('id, username'),
      picksDb.from(PICKS_TABLE).select('*').order('created_at', { ascending: true })
    ]);

    if (picks.error) {
      console.error('Pick history unavailable:', picks.error);
      setMessage('Could not read the picks table.');
      return;
    }
    if (suspects.error) {
      // Not fatal: the picks carry a username snapshot to fall back on.
      console.warn('Pick history: roster unavailable, using names off the picks:', suspects.error);
    }

    render(suspects.data || [], picks.data || []);
  }

  function render(suspects, picks) {
    const thisWeek = Number(window.CURRENT_WEEK) || 1;

    // Keyed on user_id, never on the username stored on a pick: a username can
    // change, and the snapshot on an old row is the old one.
    const people = new Map();
    for (const suspect of suspects) {
      if (suspect?.id) people.set(suspect.id, { id: suspect.id, name: suspect.username || '', weeks: new Map() });
    }

    const weeks = new Set();
    for (let week = 1; week <= thisWeek; week += 1) weeks.add(week);

    for (const pick of picks) {
      const week = Number(pick.week);
      if (!pick.user_id || !Number.isFinite(week)) continue;
      weeks.add(week);

      let person = people.get(pick.user_id);
      if (!person) {
        // Filed picks but no longer on the roster - removed from the league.
        // Still shown, because this is the raw record.
        person = { id: pick.user_id, name: (pick.username || 'unknown') + ' (gone)', weeks: new Map() };
        people.set(pick.user_id, person);
      }
      if (!person.weeks.has(week)) person.weeks.set(week, []);
      person.weeks.get(week).push(pick);
    }

    const weekList = [...weeks].sort((a, b) => a - b);
    const rows = [...people.values()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );

    els.head.innerHTML =
      '<tr><th scope="col">Suspect</th>' +
      weekList.map((week) => `<th scope="col">Wk ${week}</th>`).join('') +
      '<th scope="col" title="Rows filed beyond the first, across the season">Changes</th></tr>';

    if (!rows.length) {
      setMessage('Nobody on the roster yet.', weekList.length + 2);
      return;
    }

    let filed = 0;
    let changed = 0;

    els.body.innerHTML = rows.map((person) => {
      let changes = 0;
      const cells = weekList.map((week) => {
        const history = person.weeks.get(week) || [];
        if (!history.length) return '<td class="admin-picks-empty">-</td>';
        filed += history.length;
        changes += history.length - 1;
        return `<td>${history.map((pick, i) => entry(pick, i === history.length - 1)).join('')}</td>`;
      }).join('');
      if (changes) changed += 1;

      return `<tr><th scope="row">${escapeHtml(person.name)}</th>${cells}` +
        `<td class="admin-picks-changes">${changes || ''}</td></tr>`;
    }).join('');

    if (els.note) {
      els.note.textContent = `${filed} rows filed by ${rows.length} suspects; ${changed} of them changed a pick at least once.`;
    }
  }

  function entry(pick, standing) {
    const verdict = result(pick);
    const skip = verdict === 'SKIP';
    const classes = ['admin-picks-entry'];
    if (!standing) classes.push('admin-picks-superseded');
    if (skip) classes.push('admin-picks-skip');

    const label = skip ? `SKIP ${abbr(pick.team)}` : abbr(pick.team);
    const tag = !skip && verdict ? `<span class="admin-picks-result">${escapeHtml(verdict)}</span>` : '';
    const title = [
      skip ? `Released ${pick.team}` : pick.team,
      verdict && !skip ? verdict : '',
      `filed ${fullStamp(pick.created_at)}`,
      standing ? '' : '(superseded)'
    ].filter(Boolean).join(' - ');

    return `<div class="${classes.join(' ')}" title="${escapeHtml(title)}">` +
      `<b>${escapeHtml(label)}</b>${tag}` +
      `<span class="admin-picks-time">${escapeHtml(stamp(pick.created_at))}</span></div>`;
  }

  function setMessage(message, span) {
    if (els.note) els.note.textContent = '';
    els.body.innerHTML = `<tr><td colspan="${span || 20}" class="table-empty">${escapeHtml(message)}</td></tr>`;
  }

  window.ffAdminPicksLoad = load;
})();
