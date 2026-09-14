// ===== WEEK RESULTS =====
// The season on one page, a row per week, so the admin can see at a glance what
// has been settled, what is in play and what has been filed ahead. Everything
// else on this page is about one suspect or one action; this is the only view
// that answers "where is the season".
//
// EVERY NUMBER IS DERIVED, NEVER STORED. It reads the same two views the public
// pages read - _2026_current_suspects for the roster and its sticky standing,
// _2026_active_picks for the picks - and counts. Nothing here can disagree with
// the board, because it is the same arithmetic on the same rows.
//
// THE THREE KINDS OF ROW
//   settled   a week behind the open one
//   this week the open week
//   upcoming  a week nobody has reached yet
// The label comes from where the week sits, and the numbers say how far scoring
// actually got - so a past week with picks still pending shows it, which is the
// useful thing to see and would be hidden by a label that just said SCORED.
//
// WHAT THE COLUMNS MEAN
//   Picked    victims named for that week
//   In Play   named, and the game has not said yet
//   Survived / Dun Dun   the verdicts written
//   No Pick   scored as never having filed
// Picked = In Play + Survived + Dun Dun, every row, which makes each line check
// itself. No Pick sits outside that sum because it is the opposite of a pick:
// the scorer writes a row carrying the team NO PICK for somebody who never
// filed, and counting it as one would make a missed week look like a named
// victim. It also already carries a DUN DUN verdict, so counting it in that
// column too would count one person twice.
//
// EXHIBITION PICKS ARE NOT IN THE TABLE. A closed case may keep filing and is
// still told whether the pick won or lost, but none of it counts - see
// supabase/sql/ff_exhibition_picks.sql. Counting them in Picked or Waiting
// would make a dead suspect look live. They are reported under the table
// instead, where they are information without being a total.
(function () {
  const WEEKS_CONFIG = window.FF_SUPABASE_CONFIG || {};
  const SUSPECTS_VIEW = WEEKS_CONFIG.views?.currentSuspects || 'ff_current_suspects';
  const ACTIVE_PICKS_VIEW = WEEKS_CONFIG.views?.activePicks || 'ff_active_picks';
  const TOTAL_WEEKS = 18;
  const NO_PICK_TEAM = 'NO PICK';

  const els = {};

  // js/auth-corner.js publishes the session client and is loaded before this
  // file. Sharing it matters: a second GoTrue instance on one storage key races
  // the first.
  const weeksDb = window.ffAuthClient?.auth ? window.ffAuthClient : null;

  document.addEventListener('DOMContentLoaded', () => {
    els.panel = document.getElementById('adminWeeksPanel');
    els.body = document.getElementById('adminWeeksBody');
    els.note = document.getElementById('adminWeeksNote');
    if (!els.body) return;

    document.getElementById('btnRefreshWeeks')?.addEventListener('click', load);

    // Scoring a week rewrites every number in here, and the button that does it
    // is on this same page.
    window.addEventListener('ff-week-scored', load);
  });

  function result(row) {
    return String(row?.result || '').trim().toUpperCase();
  }

  // SKIP is a tombstone for a released week, not a pick. Anything that reads
  // picks and forgets this counts a week somebody gave back.
  function livePicks(rows) {
    return (rows || []).filter((row) => result(row) !== 'SKIP');
  }

  async function load() {
    if (!weeksDb) {
      setNote('Signed-out: no session to read the season with.');
      return;
    }

    setMessage('Reading the season...');

    const [suspects, picks] = await Promise.all([
      weeksDb.from(SUSPECTS_VIEW).select('id, username, game_status'),
      weeksDb.from(ACTIVE_PICKS_VIEW).select('user_id, week, team, result')
    ]);

    if (suspects.error || picks.error) {
      const error = suspects.error || picks.error;
      console.error('Week results unavailable:', error);
      setMessage('Could not read the season.');
      return;
    }

    render(suspects.data || [], livePicks(picks.data));
  }

  function render(suspects, picks) {
    const thisWeek = Number(window.CURRENT_WEEK) || 1;
    const ids = suspects.map((suspect) => suspect.id).filter(Boolean);

    // (user, week) -> the row, so every question below is a lookup rather than
    // a scan. One pick per week is the most anyone can have.
    const byUserWeek = new Map();
    for (const pick of picks) {
      byUserWeek.set(`${pick.user_id}|${pick.week}`, pick);
    }

    // The week a case closed, which is the FIRST DUN DUN and not the newest
    // one: out stays out, and a closed case that keeps filing must not appear
    // to rejoin the living in a later row. Same rule as _2026_is_out, counted
    // per week instead of once.
    const closedIn = new Map();
    for (const pick of picks) {
      if (result(pick) !== 'DUN DUN') continue;
      const seen = closedIn.get(pick.user_id);
      if (seen == null || pick.week < seen) closedIn.set(pick.user_id, pick.week);
    }

    let exhibition = 0;
    const rows = [];

    for (let week = 1; week <= TOTAL_WEEKS; week += 1) {
      const tally = { picked: 0, inPlay: 0, survived: 0, dunDun: 0, noPick: 0 };

      for (const id of ids) {
        const pick = byUserWeek.get(`${id}|${week}`);
        if (!pick) continue;

        // Closed BEFORE this week: an exhibition pick. The week that closed
        // somebody still counts them - they were playing when it happened - so
        // this is strictly weeks AFTER the one that ended them.
        const closed = closedIn.get(id);
        if (closed != null && closed < week) {
          exhibition += 1;
          continue;
        }

        if (String(pick.team || '').trim().toUpperCase() === NO_PICK_TEAM) {
          tally.noPick += 1;
          continue;
        }

        tally.picked += 1;

        const verdict = result(pick);
        if (verdict === 'SURVIVED') tally.survived += 1;
        else if (verdict === 'DUN DUN') tally.dunDun += 1;
        else tally.inPlay += 1;
      }

      rows.push({ week, tally });
    }

    paint(rows, thisWeek, exhibition);
  }

  // A zero that answers a question is a fact; a zero to a question that cannot
  // be asked yet is noise. Upcoming weeks have no verdicts, so those cells are
  // dashed rather than filled with three zeros a reader has to discount.
  function cell(value, applies) {
    if (!applies) return '<td class="admin-weeks-na">&middot;</td>';
    return `<td${value ? '' : ' class="admin-weeks-zero"'}>${value}</td>`;
  }

  function paint(rows, thisWeek, exhibition) {
    const html = rows.map(({ week, tally }) => {
      const state = week < thisWeek ? 'settled' : (week === thisWeek ? 'this week' : 'upcoming');

      // Nothing has been decided in a week that has not been played.
      const judged = week <= thisWeek;

      return `
        <tr class="admin-weeks-row admin-weeks-row-${state.replace(' ', '-')}">
          <th scope="row">Week ${week}</th>
          <td class="admin-weeks-state">${state}</td>
          ${cell(tally.picked, true)}
          ${cell(tally.inPlay, true)}
          ${cell(tally.survived, judged)}
          ${cell(tally.dunDun, judged)}
          ${cell(tally.noPick, judged)}
        </tr>`;
    }).join('');

    els.body.innerHTML = html;

    // Only ever says something when there is something to say. The roster
    // total used to sit here and was already the In + Out of every row above -
    // a line of standing text under a table that restates the table.
    setNote(exhibition
      ? `${exhibition} exhibition pick${exhibition === 1 ? '' : 's'} from closed cases, judged but never counted - not in any column above.`
      : '');
  }

  function setMessage(text) {
    if (els.body) els.body.innerHTML = '<tr><td colspan="7" class="table-empty">' + text + '</td></tr>';
  }

  function setNote(text) {
    if (els.note) els.note.textContent = text || '';
  }

  // Called by js/admin.js once the gate has let somebody in, the same way the
  // to do list is. Nothing here is secret - both views are public reads - but
  // there is no reason to ask for them before the page is anybody's.
  window.ffAdminWeeksLoad = load;
})();
