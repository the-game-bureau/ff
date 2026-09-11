// ===== SCORING A WEEK =====
// Turning NFL results into league results: picked a loser and you survive,
// picked a winner or a tie and the case closes on you, and if the last game of
// the week kicks off with nothing filed, it closes anyway.
//
// SAFE TO RUN OVER AND OVER
// That is the point of it. Press it every day of the week if you like: games
// that have not finished are left alone and reported as pending, a result that
// is already written is written again to the same value, and somebody already
// marked as never having filed is not marked twice.
//
// Until this existed there was no process. Nothing on the site ever wrote
// SURVIVED or DUN DUN - every reference to them in js/ reads - so a week was
// scored by opening the Supabase table editor and typing thirty rows by hand.
//
// WHERE THE RESULTS COME FROM
// The scoreboard itself, fetched here in the browser when the button is pressed
// - see js/nfl-live-scores.js. Pressing Preview scrapes and previews; pressing
// Score The Week scrapes and writes. There is nothing to regenerate, commit or
// deploy first, and it works from whatever device the admin happens to have.
//
// js/nfl-scores.js is still the fallback. If the fetch fails - offline, or ESPN
// changes - the panel says so and scores from the generated file exactly as it
// used to. That path is unchanged and still works; it just is not the one
// anybody has to think about any more.
//
// The database is told the outcome rather than asked to go and find it, so the
// admin sees exactly what is about to be written before any of it is.
//
// NOTHING IS WRITTEN WITHOUT A LOOK FIRST
// Preview and commit are the same call to _2026_admin_score_week with one
// argument flipped, so what the preview shows is what the commit does - not a
// second implementation that might disagree with it.
(function () {
  const SCORE_CONFIG = window.FF_SUPABASE_CONFIG || {};
  const SCORE_RPC = SCORE_CONFIG.rpcs?.adminScoreWeek || '_2026_admin_score_week';
  const PICKS_TABLE = SCORE_CONFIG.tables?.picks || 'ff_picks';

  // Read by js/wire.js in whatever other tabs are open. The value is only a
  // timestamp; what matters is that it changed.
  const WEEK_SCORED_KEY = 'ff-week-scored-at';
  const TOTAL_WEEKS = 18;

  let previewedWeek = 0;

  // Week -> games, in NFL_SCORE_GAMES shape, from the live scoreboard. Empty
  // until something has been fetched; a week that is not in here falls back to
  // the generated file.
  const liveScores = new Map();
  let liveFetchedAt = 0;
  let liveFailed = false;

  const els = {};

  const scoreDb = window.ffAuthClient?.auth ? window.ffAuthClient : null;

  document.addEventListener('DOMContentLoaded', () => {
    els.panel = document.getElementById('adminScorePanel');
    els.week = document.getElementById('adminScoreWeek');
    els.games = document.getElementById('adminScoreGames');
    els.last = document.getElementById('adminScoreLast');
    els.preview = document.getElementById('btnPreviewScore');
    els.commit = document.getElementById('btnCommitScore');
    els.report = document.getElementById('adminScoreReport');
    if (!els.week) return;

    for (let week = 1; week <= TOTAL_WEEKS; week += 1) {
      const option = document.createElement('option');
      option.value = String(week);
      option.textContent = `Week ${week}`;
      els.week.appendChild(option);
    }
    els.week.value = String(Number(window.CURRENT_WEEK) || 1);

    els.week.addEventListener('change', () => {
      // A preview belongs to the week it was taken of.
      previewedWeek = 0;
      els.commit.disabled = true;
      els.report.innerHTML = '';
      describeWeek();
      showLastScored();
    });

    els.preview.addEventListener('click', () => run(false));
    els.commit.addEventListener('click', () => run(true));

    describeWeek();
    showLastScored();
  });

  // When this week was last judged. Comes off _2026_picks.scored_at, which the
  // trigger in supabase/sql/ff_scored_at.sql stamps whenever a row's result
  // becomes a verdict - so it answers "was this week scored, and when" without
  // anybody having to remember.
  //
  // Its own forgiving query: the column arrives with that file, and asking for
  // a column that is not there yet fails the request. A failure here is a line
  // that says it cannot tell, not a broken panel.
  async function showLastScored() {
    if (!els.last || !scoreDb) return;

    const week = selectedWeek();
    els.last.textContent = '';

    const { data, error } = await scoreDb
      .from(PICKS_TABLE)
      .select('scored_at')
      .eq('week', week)
      .not('scored_at', 'is', null)
      .order('scored_at', { ascending: false })
      .limit(1);

    // The week may have changed while this was in flight.
    if (week !== selectedWeek()) return;

    if (error) {
      els.last.textContent =
        'Cannot tell when this week was last scored: run supabase/sql/ff_scored_at.sql.';
      return;
    }

    const at = data?.[0]?.scored_at ? new Date(data[0].scored_at) : null;
    els.last.textContent = at && !Number.isNaN(at.getTime())
      ? `Week ${week} was last scored ${window.ffLongWhen?.(at) || 'at an unknown time'}.`
      : `Week ${week} has never been scored.`;
  }

  function selectedWeek() {
    return Number(els.week?.value) || 1;
  }

  // The week's games, live if they have been fetched and from the generated file
  // if not. Everything downstream reads this rather than either source, so there
  // is one answer to "what do we know about this week" however it was obtained.
  function weekScores(week) {
    return liveScores.get(Number(week)) ||
      window.NFL_SCORE_HELPERS?.getWeekScores?.(week) || [];
  }

  function isLive(week) {
    return liveScores.has(Number(week));
  }

  // Fetches the week unless it is already in hand. Never throws: a failure here
  // means falling back to the file, which is a worse answer and not a broken
  // one, and the panel says which happened.
  async function ensureLiveScores(week, refetch = false) {
    if (!refetch && liveScores.has(Number(week))) return;
    if (!window.ffLiveScores) return;

    try {
      const games = await window.ffLiveScores.fetchWeek(
        Number(window.SEASON) || 2026, Number(week));
      liveScores.set(Number(week), games);
      liveFetchedAt = Date.now();
      liveFailed = false;
    } catch (error) {
      liveFailed = true;
      console.warn('Live scoreboard unavailable, using js/nfl-scores.js:', error);
    }
  }

  // Every team in a finished game, and what happened to it. Two entries per
  // game, because a pick names one side.
  function finalsForWeek(week) {
    const games = weekScores(week);
    const outcomeFor = isLive(week)
      ? window.ffLiveScores?.outcomeFor
      : window.NFL_SCORE_HELPERS?.getTeamResultFromGame;
    if (!outcomeFor) return [];

    const finals = [];
    for (const game of games) {
      if (!game.final) continue;
      for (const team of [game.away, game.home]) {
        const outcome = outcomeFor(game, team);
        if (outcome) finals.push({ team, outcome });
      }
    }
    return finals;
  }

  function scheduledCount(week) {
    const games = window.NFL_SCHEDULE_GAMES || [];
    return games.filter((game) => Number(game.week) === Number(week)).length;
  }

  function finalCount(week) {
    return weekScores(week).filter((game) => game.final).length;
  }

  // Games that kicked off long enough ago to be over, with no final on file.
  //
  // This is the one way the whole arrangement fails quietly: js/nfl-scores.js is
  // a generated file, so a week's second game is not "not detected", it is not
  // in the file yet - and an out-of-date file looks exactly like a week where
  // nothing has finished. Counting them lets the panel say which it is.
  //
  // Four hours: an NFL game runs a little over three, and being early here only
  // costs a warning that clears itself on the next fetch.
  const LIKELY_OVER_MS = 4 * 60 * 60 * 1000;

  function missingFinals(week, now = Date.now()) {
    // Cannot happen against the live scoreboard - it has every game - so this
    // only ever reports on the generated file.
    if (isLive(week)) return 0;

    const scored = window.NFL_SCORE_HELPERS?.getWeekScores?.(week) || [];
    const haveFinal = new Set(
      scored.filter((game) => game.final).map((game) => matchKey(game.away, game.home))
    );

    return (window.NFL_SCHEDULE_GAMES || [])
      .filter((game) => Number(game.week) === Number(week))
      .filter((game) => {
        const kickoff = Date.parse(game.kickoffUtc || '');
        if (!Number.isFinite(kickoff)) return false;
        if (now - kickoff < LIKELY_OVER_MS) return false;
        return !haveFinal.has(matchKey(game.away, game.home));
      }).length;
  }

  function matchKey(away, home) {
    return [away, home]
      .map((name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ''))
      .join('|');
  }

  function fetchedAgo(week, now = Date.now()) {
    const stamp = isLive(week) ? liveFetchedAt : Date.parse(window.NFL_SCORE_FETCHED_AT || '');
    if (!Number.isFinite(stamp)) return 'at an unknown time';

    const hours = Math.floor((now - stamp) / (60 * 60 * 1000));
    if (hours < 1) return 'just now';
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  // Picks lock five minutes before their own team's game, so once the last game
  // of the week has kicked off there is no way left to file one. That, and not
  // the last final, is the moment a missing pick becomes an elimination -
  // waiting for the game to end would just be waiting.
  //
  // A week still carrying a game with no kickoff time cannot be judged, so it is
  // treated as open. Weeks 16 and 17 have those until the schedule is
  // regenerated.
  function picksClosed(week, now = Date.now()) {
    const games = (window.NFL_SCHEDULE_GAMES || [])
      .filter((game) => Number(game.week) === Number(week));
    if (!games.length) return false;

    const kickoffs = games.map((game) => Date.parse(game.kickoffUtc || ''));
    if (kickoffs.some((stamp) => !Number.isFinite(stamp))) return false;

    return now >= Math.max(...kickoffs);
  }

  function describeWeek() {
    if (!els.games) return;

    const week = selectedWeek();
    const scheduled = scheduledCount(week);

    if (!scheduled) {
      els.games.textContent = 'No games on the schedule for that week.';
      return;
    }

    const finals = finalCount(week);
    const missing = missingFinals(week);

    const state = picksClosed(week)
      ? 'Picks are closed for the week, so anyone who never filed is out.'
      : 'Picks are still open, so nobody is out for a missing one yet.';

    // Said first, because it is the reason a game that has plainly been played
    // is not in the count.
    const stale = missing
      ? `${missing} game${missing === 1 ? ' has' : 's have'} been played with no score on file - ` +
        'run tools/update-nfl-scores.mjs and deploy. '
      : '';

    // Which scoreboard these numbers came from. It matters: one of them is
    // current by definition and the other is as old as the last deploy.
    const source = isLive(week)
      ? `Read from the live scoreboard ${fetchedAgo(week)}.`
      : `From js/nfl-scores.js, fetched ${fetchedAgo(week)}.` +
        (liveFailed ? ' The live scoreboard could not be reached.' : '');

    els.games.textContent = `${stale}${finals} of ${scheduled} final. ${state} ${source}`;
    els.games.classList.toggle('admin-score-stale', Boolean(missing) || liveFailed);
  }

  async function run(commit) {
    if (!scoreDb) return;

    const week = selectedWeek();

    if (commit && previewedWeek !== week) {
      window.ffToast?.('Preview it first.', 'note', 'score');
      return;
    }

    // Scrape, then score. Refetched on every press rather than cached for the
    // session, because pressing this twenty minutes later is how the week gets
    // followed through Sunday and a cached scoreboard would quietly hand back
    // the same answer every time.
    els.preview.disabled = true;
    els.commit.disabled = true;
    els.games.textContent = 'Reading the scoreboard...';
    await ensureLiveScores(week, true);
    describeWeek();

    const finals = finalsForWeek(week);

    // Nothing final and nothing closed means there is genuinely nothing to do.
    // Said rather than sent, because running this every day of the week is the
    // expected way to use it and a no-op should not look like a failure.
    if (!finals.length && !picksClosed(week)) {
      window.ffToast?.(
        isLive(week)
          ? `No games have finished in Week ${week} yet.`
          : `No final scores on file for Week ${week} yet. Run tools/update-nfl-scores.mjs and deploy.`,
        'note', 'score');
      els.preview.disabled = false;
      return;
    }

    // Not a refusal - scoring what IS on file is still worth doing - but it has
    // to be said, or a week gets committed against a file that is a day behind
    // and the games missing from it look like nobody picked them.
    const behind = missingFinals(week);
    if (behind) {
      window.ffToast?.(
        `${behind} played game${behind === 1 ? '' : 's'} missing from js/nfl-scores.js. ` +
        'Scoring what is on file; regenerate it to catch the rest.',
        'note', 'score-stale');
    }

    const { data, error } = await scoreDb.rpc(SCORE_RPC, {
      p_week: week,
      p_finals: finals,
      p_picks_closed: picksClosed(week),
      p_commit: Boolean(commit)
    });

    els.preview.disabled = false;

    if (error) {
      const missing = error.code === 'PGRST202' ||
        /could not find the function|does not exist/i.test(error.message || '');
      window.ffToast?.(
        missing
          ? 'Scoring is not switched on yet: run supabase/sql/ff_score_week.sql.'
          : `Scoring failed: ${error.message}`,
        'bad', 'score');
      console.error('_2026_admin_score_week failed:', error);
      return;
    }

    renderReport(data, commit);

    if (commit) {
      previewedWeek = 0;
      const written = (data.survived?.length || 0) + (data.dun_dun?.length || 0) +
        (data.no_pick?.length || 0);
      window.ffToast?.(`Week ${week} scored. ${written} record${written === 1 ? '' : 's'} written.`,
        'good', 'score');
      // The roster's pick counts and everything else on the page are now stale.
      window.dispatchEvent(new CustomEvent('ff-auth-changed', { detail: { user: null, profile: null } }));
      announceScored();
      showLastScored();
    } else {
      previewedWeek = week;
      els.commit.disabled = false;
      window.ffToast?.('Nothing written yet. Check it, then Score The Week.', 'note', 'score');
    }
  }

  // Every other tab of this site is now showing results that are a week out of
  // date - the wire on the Precinct most of all, since every sentence on it is
  // built from the rows this just rewrote. A storage write fires the storage
  // event in the OTHER tabs of the origin and not in this one, which is the
  // reach wanted: nothing here needs telling, everything else does.
  //
  // Best effort. Private windows and blocked site data throw on write, and a
  // scored week is not worth failing over a notification nobody may be
  // listening for.
  function announceScored() {
    try {
      window.localStorage.setItem(WEEK_SCORED_KEY, String(Date.now()));
    } catch (err) {
      console.warn('Could not announce the scored week to other tabs:', err);
    }
  }

  function renderReport(data, committed) {
    const groups = [
      ['Survived', data.survived, 'good'],
      ['Dun Dun', data.dun_dun, 'bad'],
      ['Never filed', data.no_pick, 'bad'],
      // Nothing filed, but the last game has not kicked off, so nothing is
      // written against them yet. Reported so the totals below cover the whole
      // roster - they used to be left out entirely, and a mid-week run listed
      // fewer suspects than the league has with no way to tell who was missing.
      ['No victim yet', data.unfiled, 'note'],
      ['Not final yet', data.pending, 'note']
    ];

    els.report.innerHTML = `
      <p class="admin-score-headline">${committed ? 'Written' : 'Would write'} for Week ${Number(data.week)}:</p>
      ${groups.map(([label, rows, kind]) => `
        <div class="admin-score-group admin-score-group-${kind}">
          <span class="admin-score-label">${escapeHtml(label)}</span>
          <span class="admin-score-count">${(rows || []).length}</span>
          <span class="admin-score-names">${(rows || []).map(nameOf).join(', ') || '-'}</span>
        </div>`).join('')}
      ${tallyHtml(data, groups)}
    `;
  }

  // Does the report add up? Everyone on the roster is either in one of the
  // groups above or was already out before this week. If those do not sum to
  // the roster, something upstream is dropping suspects and the screen says so
  // rather than quietly showing a short list.
  function tallyHtml(data, groups) {
    // The old function returned neither of these. Without them there is no way
    // to tell a genuine zero from a group the database never filled in - which
    // is exactly how NO VICTIM YET sat at 0 while three suspects had filed
    // nothing at all. Say which it is instead of printing a number that looks
    // like an answer.
    if (data.roster === undefined || data.unfiled === undefined) {
      return `
        <p class="admin-score-tally admin-score-tally-off">
          Scoring function is out of date: suspects who have filed nothing are not
          being reported, so the counts above cover only the suspects who have.
          Run supabase/sql/ff_score_week.sql.
        </p>`;
    }

    const roster = Number(data.roster || 0);
    if (!roster) return '';

    const listed = groups.reduce((sum, [, rows]) => sum + (rows || []).length, 0);
    const closed = Number(data.closed_before || 0);
    const accounted = listed + closed;

    return `
      <p class="admin-score-tally${accounted === roster ? '' : ' admin-score-tally-off'}">
        ${listed} listed + ${closed} already out = ${accounted} of ${roster} suspects
        ${accounted === roster ? '' : ' - some are unaccounted for'}
      </p>`;
  }

  function nameOf(row) {
    const name = escapeHtml(row.username || '(unknown)');
    return row.team ? `${name} (${escapeHtml(row.team)})` : name;
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
