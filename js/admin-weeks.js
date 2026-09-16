// ===== WEEK RESULTS =====
// The season on one page, a row per week, so the admin can see at a glance what
// has been settled, what has been filed and where the league stands. Everything
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
// THREE CELLS, THREE NUMBERS EACH, ALL THE SAME SHAPE
//   Wk Picks        In/Out/In% - of the suspects still in that week, how many
//                   have named a victim, how many have not, and the first as a
//                   share of them
//   Wk Start Status In/Out/In% - the league AS THE WEEK OPENED: still a
//                   suspect, case closed, and what share of the roster that is
//   Wk End Status   In/Out/In% - the same three, taken after the week's
//                   verdicts have landed
// The same three numbers three times, each read against its own column: in and
// out of the PICK, then in and out of the GAME at either end of the week. Two
// counts that add up to a roster and the share the first one is - in Picks that
// roster is the suspects still in that week, in the two statuses it is the whole
// league. The first number is always the one being read and the other two
// qualify it, which is why they are muted. WK START and WK END are spelled out
// in the headings rather than left to a tooltip, because three Outs sit in a row
// and the first of them is a different thing: an unfiled pick, then a closed
// case, then a closed case again a few hours later.
//
// START TO END IS WHAT THE WEEK COST, and the row is meant to be read across:
// 18/2/90% then 15/5/75% is three cases closed. It chains down the page too -
// a week's End is the next week's Start - which makes the table check itself.
//
// A STATUS IS A STANDING, NOT A VERDICT, and CLAUDE.md is strict about the
// difference: In and Out are STILL A SUSPECT and CASE CLOSED counted. Three
// columns used to sit where the statuses do - In Play, Survived, Dun Dun - and
// Survived counted SURVIVED verdicts, which put a verdict word over a count of
// people: "20 survived, 2 dun dun" out of twenty read as a contradiction.
//
// A NO PICK row is the opposite of a pick and never counts as one: it would
// make a missed week look like a named victim. It lands in Picks' Out, where
// somebody who simply had not filed yet already was - which is the same fact
// before and after scoring, said with more certainty. It closes a case like any
// other DUN DUN, so it moves somebody across between Start and End.
//
// EXHIBITION PICKS ARE NOT IN THE TABLE AT ALL. A closed case may keep filing
// and is still told whether the pick won or lost, but none of it counts - see
// supabase/sql/ff_exhibition_picks.sql. Counting them anywhere here would make
// a dead suspect look live, so they are skipped and not reported. There was a
// line under the table saying how many had been skipped; it was a footnote
// about nothing on almost every load.
(function () {
  const WEEKS_CONFIG = window.FF_SUPABASE_CONFIG || {};
  const SUSPECTS_VIEW = WEEKS_CONFIG.views?.currentSuspects || 'ff_current_suspects';
  const ACTIVE_PICKS_VIEW = WEEKS_CONFIG.views?.activePicks || 'ff_active_picks';
  const TOTAL_WEEKS = 18;
  const NO_PICK_TEAM = 'NO PICK';

  // The rule both cells hang their three numbers on.
  const SLASH = '<span class="admin-weeks-slash">/</span>';

  const els = {};

  // js/auth-corner.js publishes the session client and is loaded before this
  // file. Sharing it matters: a second GoTrue instance on one storage key races
  // the first.
  const weeksDb = window.ffAuthClient?.auth ? window.ffAuthClient : null;

  document.addEventListener('DOMContentLoaded', () => {
    els.panel = document.getElementById('adminWeeksPanel');
    els.body = document.getElementById('adminWeeksBody');
    if (!els.body) return;

    document.getElementById('btnRefreshWeeks')?.addEventListener('click', load);

    // Scoring a week rewrites every number in here, and the button that does it
    // is on this same page.
    window.addEventListener('ff-week-scored', load);

    // Delegated, because every pie in the table is thrown away and rebuilt on
    // each load - a listener per button would have to be hung again every time.
    els.body.addEventListener('click', (event) => {
      const button = event.target.closest('.admin-weeks-pie');
      if (button) openPie(button.dataset);
    });
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
    // The league's open week, not the schedule's. See js/season.js.
    await window.ffOpenWeekReady;

    if (!weeksDb) {
      setMessage('Signed out: no session to read the season with.');
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

    // The same map read the other way round: how many cases closed IN each
    // week, which is what the chart draws.
    const closedByWeek = new Map();
    for (const week of closedIn.values()) {
      closedByWeek.set(week, (closedByWeek.get(week) || 0) + 1);
    }

    const rows = [];

    for (let week = 1; week <= TOTAL_WEEKS; week += 1) {
      const tally = { stillIn: 0, out: 0, picks: 0, closed: closedByWeek.get(week) || 0 };

      for (const id of ids) {
        // Closed BEFORE this week. The week that closed somebody still counts
        // them as in - they were playing when it happened - so Out is strictly
        // the weeks AFTER the one that ended them, and anything they filed
        // there is an exhibition pick.
        const closed = closedIn.get(id);
        if (closed != null && closed < week) {
          tally.out += 1;
          continue;
        }

        // Still a suspect as the week opened, whether they filed or not: the
        // first number in Status, and the denominator for the share in Picks.
        tally.stillIn += 1;

        const pick = byUserWeek.get(`${id}|${week}`);
        if (!pick) continue;

        // Scored as never having filed. Not a pick, so it stays in Picks' Out
        // alongside everybody who has not got round to it yet.
        if (String(pick.team || '').trim().toUpperCase() === NO_PICK_TEAM) continue;

        tally.picks += 1;
      }

      rows.push({ week, tally });
    }

    paint(rows, thisWeek);
  }

  // The week's filing, on one slash rule: In/Out/In%. Of the suspects still in
  // that week, who has named a victim and who has not, then the first as a
  // share of the two together.
  //
  // Out is counted as everybody still in minus everybody who filed, rather than
  // from rows of its own - not filing leaves no row to count. After scoring it
  // is exactly the NO PICK rows; before it, it is simply who is late.
  //
  // Every row can answer this, upcoming ones included: they read against the
  // people who could file for that week right now, which is a fact about today
  // rather than a guess about the week.
  function picksCell(week, tally) {
    const share = tally.stillIn ? Math.round((tally.picks / tally.stillIn) * 100) : null;
    const unfiled = tally.stillIn - tally.picks;

    return '<td>'
      + slot('admin-weeks-in', tally.picks)
      + SLASH + slot('admin-weeks-out', unfiled)
      + SLASH + slot('admin-weeks-share', share == null ? '&middot;' : share + '%')
      + pie(week, 'Picks', tally.picks, unfiled, 'Victim Named', 'Not Named')
      + '</td>';
  }

  // The share again, as a picture: green for In, red for Out. It says nothing
  // the number beside it does not, which is the point - the column is scanned
  // more often than it is read, and a row of wedges can be taken in at a glance
  // where a row of percentages has to be gone through one at a time.
  //
  // A BUTTON AND NOT A SPAN, because clicking one opens it at a size you can
  // read - and because a thing that can be clicked has to be reachable from a
  // keyboard and has to say what it is. It carries its own numbers on data
  // attributes rather than having the popup read them back out of the row: the
  // cell that drew the wedge is the one that knows what its two colours mean.
  //
  // The angle is a data attribute moved to a custom property by paint(),
  // because the pages carry no inline style attributes.
  //
  // ALL OF ONE COLOUR IS FLAGGED RATHER THAN DRAWN. A conic gradient still
  // paints a hairline of the second colour where its two ends meet, so a full
  // house came out as a green circle with a red seam through it, which reads as
  // somebody being out. The class swaps the gradient for a flat fill.
  //
  // It takes the counts and not the share so that the flag cannot disagree with
  // the picture: the share is rounded, and a rounded 100% is not the same claim
  // as nobody being out.
  function pie(week, heading, inCount, outCount, inLabel, outLabel) {
    const total = inCount + outCount;
    if (!total) return '';

    const solid = outCount === 0 ? ' admin-weeks-pie-all-in'
      : (inCount === 0 ? ' admin-weeks-pie-all-out' : '');

    // "Week 2 Start", not "Week 2 - Wk Start Status": the popup is opened from
    // the cell it belongs to, so the column's full name is already known and the
    // heading only has to say which of the three this one is.
    const title = `Week ${week} ${heading}`;

    return `<button type="button" class="admin-weeks-pie${solid}"`
      + ` data-pie="${Math.round((inCount / total) * 100)}"`
      + ` data-title="${title}"`
      + ` data-in="${inCount}" data-out="${outCount}"`
      + ` data-in-label="${inLabel}" data-out-label="${outLabel}"`
      + ` title="${inLabel} ${inCount}, ${outLabel} ${outCount}"`
      + ` aria-label="${title}: ${inLabel} ${inCount}, ${outLabel} ${outCount}. Open chart."`
      + '></button>';
  }

  // One number, wearing the class that says which of the three it is - the
  // first is read, the other two are muted. A zero is muted here rather than on
  // the cell, which would have taken all three numbers down with it.
  //
  // These are not padded to a width. They were, so that the digits lined up as
  // three sub-columns, and it printed a space after the slash in every cell
  // with a single-digit count - see the note in css/site.css.
  function slot(className, value) {
    const muted = value === 0 ? ' admin-weeks-zero' : '';
    return `<span class="${className}${muted}">${value}</span>`;
  }

  // The league at a moment in the week, in the same three numbers: In/Out/In%.
  // Written once and called twice, for the two ends of the week - the only
  // difference is whether that week's own casualties have been moved across
  // yet, and two copies of this would have been two places to get that wrong.
  //
  // In and Out add up to the whole roster and the share is the first out of
  // that, so the three check each other. Across the row they chain: this week's
  // End is next week's Start, and the gap between Start and End is what the
  // week cost. The headings say WK START and WK END because Out here is a closed
  // case, while Out in the Picks cell is an unfiled pick.
  //
  // Whether the caller knows the answer yet is the caller's business - see the
  // two flags in paint(). Given nothing to say, this says nothing.
  function statusCell(week, heading, stillIn, out, known) {
    if (!known) return '<td class="admin-weeks-na">&middot;</td>';

    const roster = stillIn + out;
    const share = roster ? Math.round((stillIn / roster) * 100) : null;

    return '<td>'
      + slot('admin-weeks-in', stillIn)
      + SLASH + slot('admin-weeks-out', out)
      + SLASH + slot('admin-weeks-share', share == null ? '&middot;' : share + '%')
      // DUN DUN and not CASE CLOSED on the red, by request. Worth knowing that
      // CLAUDE.md says the opposite - DUN DUN is a verdict on one week's pick
      // and CASE CLOSED is what a person is - and this is a count of people. It
      // is deliberate, so do not quietly put it back.
      + pie(week, heading, stillIn, out, 'Still A Suspect', 'Dun Dun')
      + '</td>';
  }

  function paint(rows, thisWeek) {
    const html = rows.map(({ week, tally }) => {
      const state = week < thisWeek ? 'settled' : (week === thisWeek ? 'this week' : 'upcoming');

      // The two ends of the week are known at different times, and the gap
      // between these two lines is the whole open week.
      //
      // Who WALKS IN is settled the moment the week before it is judged, so
      // every week up to and including the open one can say it. A week nobody
      // has reached cannot: printing today's standing there would be a guess
      // dressed as a count.
      //
      // Who WALKS OUT is not settled until the week is, so the open week is
      // dashed rather than showing the running total. Everything else in this
      // table reports how far scoring got and is read that way; a cell headed
      // WK END saying 15 mid-Sunday would not be - it would read as the week
      // having ended on 15, which is a different claim from the one the numbers
      // are making.
      const startKnown = week <= thisWeek;
      const endKnown = week < thisWeek;

      return `
        <tr class="admin-weeks-row admin-weeks-row-${state.replace(' ', '-')}">
          <th scope="row">Week ${week}</th>
          <td class="admin-weeks-state">${state}</td>
          ${picksCell(week, tally)}
          ${statusCell(week, 'Start', tally.stillIn, tally.out, startKnown)}
          ${statusCell(week, 'End', tally.stillIn - tally.closed, tally.out + tally.closed, endKnown)}
        </tr>`;
    }).join('');

    els.body.innerHTML = html;

    // A conic gradient wants its angle as a property, and the markup cannot
    // carry one - so the wedge rides in as a data attribute and is moved across
    // here, the same way every other generated colour on this site is set.
    els.body.querySelectorAll('.admin-weeks-pie').forEach((el) => {
      el.style.setProperty('--pie', el.dataset.pie);
    });
  }

  // ===== THE PIE, LARGE =====
  // 11 pixels is enough to see that a split exists and not enough to read it,
  // so clicking one opens the same two numbers at a size that can be, with each
  // count written on its own slice. Nothing is fetched to do it: the button
  // carries what it drew.
  //
  // Drawn in SVG rather than the conic gradient the small one uses, because a
  // label has to sit at the middle of a wedge and only a path knows where that
  // is. It also keeps the geometry out of the stylesheet, which is where the
  // no-inline-styles rule would otherwise have forced it.
  // The box is wider than the pie is round, and deliberately: a thin slice puts
  // its label outside the circle, and the widest one - at three or nine o'clock
  // - needs room for the whole string beyond the edge. Sized for that case even
  // though most pies do not have one, because a viewBox that changed shape with
  // the data would make the pie itself a different size from one week to the
  // next.
  const PIE_BOX_W = 320;
  const PIE_BOX_H = 230;
  const PIE_CX = 160;
  const PIE_CY = 112;
  const PIE_R = 86;
  // Under this many degrees a slice cannot hold its own label, so the label
  // goes outside the pie instead. 54 degrees is 15% of the circle.
  const PIE_THIN = 54;

  function piePoint(angle, radius) {
    const radians = ((angle - 90) * Math.PI) / 180;
    return [
      (PIE_CX + radius * Math.cos(radians)).toFixed(1),
      (PIE_CY + radius * Math.sin(radians)).toFixed(1)
    ];
  }

  function pieWedge(from, to) {
    const [x1, y1] = piePoint(from, PIE_R);
    const [x2, y2] = piePoint(to, PIE_R);
    return `M ${PIE_CX} ${PIE_CY} L ${x1} ${y1} A ${PIE_R} ${PIE_R} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2} Z`;
  }

  // The count and its share, on the slice - or just outside it, in black, when
  // the slice is too thin to hold the words without them running over the edge.
  //
  // An outside label is anchored AWAY from the pie rather than centred on its
  // point: centred, a label out at three o'clock lies half across the circle it
  // is labelling. Near the top and bottom there is no away to point at, so
  // those stay centred - which is also where they have the most room.
  function pieWedgeLabel(from, to, count, share) {
    const thin = to - from < PIE_THIN;
    const mid = (from + to) / 2;
    const [x, y] = piePoint(mid, thin ? PIE_R + 8 : PIE_R * 0.5);

    const vertical = mid < 20 || mid > 340 || (mid > 160 && mid < 200);
    const anchor = !thin || vertical ? 'middle' : (mid < 180 ? 'start' : 'end');

    return `<text class="admin-weeks-pie-label${thin ? ' admin-weeks-pie-label-outside' : ''}"`
      + ` x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle">${count} (${share}%)</text>`;
  }

  function bigPie(inCount, outCount, inLabel, outLabel) {
    const total = inCount + outCount;
    const inShare = Math.round((inCount / total) * 100);
    const label = `${inLabel} ${inCount}, ${outLabel} ${outCount}`;

    let body;

    // All of one colour. An arc from a point back to itself draws nothing, so
    // the whole-circle case cannot be a wedge and has to be a circle - the same
    // seam the small pie has a flat fill for, in a different disguise.
    if (inCount === 0 || outCount === 0) {
      const allIn = outCount === 0;
      body = `<circle class="${allIn ? 'admin-weeks-pie-in' : 'admin-weeks-pie-out'}" cx="${PIE_CX}" cy="${PIE_CY}" r="${PIE_R}"/>`
        + `<text class="admin-weeks-pie-label" x="${PIE_CX}" y="${PIE_CY}" text-anchor="middle" dominant-baseline="middle">${allIn ? inCount : outCount} (100%)</text>`;
    } else {
      const sweep = (inCount / total) * 360;
      body = `<path class="admin-weeks-pie-in" d="${pieWedge(0, sweep)}"/>`
        + `<path class="admin-weeks-pie-out" d="${pieWedge(sweep, 360)}"/>`
        + pieWedgeLabel(0, sweep, inCount, inShare)
        + pieWedgeLabel(sweep, 360, outCount, 100 - inShare);
    }

    return `<svg class="admin-weeks-pie-big" viewBox="0 0 ${PIE_BOX_W} ${PIE_BOX_H}" role="img" aria-label="${label}">${body}</svg>`;
  }

  function ensurePieModal() {
    let modal = document.getElementById('adminWeeksPieModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'adminWeeksPieModal';
    modal.className = 'modal-backdrop';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="modal-card admin-weeks-pie-card" role="dialog" aria-modal="true"
           aria-labelledby="adminWeeksPieTitle" tabindex="-1">
        <button class="modal-close" type="button" data-pie-close aria-label="Close">&times;</button>
        <h2 id="adminWeeksPieTitle"></h2>
        <div id="adminWeeksPieFigure"></div>
        <ul class="admin-weeks-pie-key">
          <li class="admin-weeks-pie-key-in" id="adminWeeksPieKeyIn"></li>
          <li class="admin-weeks-pie-key-out" id="adminWeeksPieKeyOut"></li>
        </ul>
      </div>`;

    document.body.appendChild(modal);

    modal.addEventListener('click', (event) => {
      if (event.target === modal || event.target.closest('[data-pie-close]')) closePie();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.hidden) closePie();
    });

    return modal;
  }

  // What the button was carrying, opened. The counts arrive as strings off the
  // dataset, which is why they are put through Number here and nowhere else.
  function openPie(data) {
    const modal = ensurePieModal();
    const inCount = Number(data.in);
    const outCount = Number(data.out);

    document.getElementById('adminWeeksPieTitle').textContent = data.title;
    document.getElementById('adminWeeksPieFigure').innerHTML =
      bigPie(inCount, outCount, data.inLabel, data.outLabel);
    document.getElementById('adminWeeksPieKeyIn').textContent = data.inLabel;
    document.getElementById('adminWeeksPieKeyOut').textContent = data.outLabel;

    // The slices carry the numbers, the key carries what they mean - between
    // them nothing is said twice.
    modal.hidden = false;
    modal.querySelector('.modal-card').focus();
  }

  function closePie() {
    const modal = document.getElementById('adminWeeksPieModal');
    if (modal) modal.hidden = true;
  }

  function setMessage(text) {
    if (els.body) els.body.innerHTML = '<tr><td colspan="5" class="table-empty">' + text + '</td></tr>';
  }

  // Called by js/admin.js once the gate has let somebody in, the same way the
  // to do list is. Nothing here is secret - both views are public reads - but
  // there is no reason to ask for them before the page is anybody's.
  window.ffAdminWeeksLoad = load;
})();
