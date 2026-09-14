// ===== SERGEANT'S NOTES =====
// The things a desk sergeant would have written down while the board filled in:
// who is exposed, what settles when, and which single result would gut the
// league. Everything on this page states a fact about one suspect or one week;
// this is the one place that says what those facts add up to.
//
// Every note is DERIVED, never typed. A hand-written observation is true on the
// Sunday somebody writes it and quietly wrong by Tuesday, and a notebook of
// stale remarks is worse than an empty one - so each note is a function that
// either finds something worth saying in the current data or returns nothing.
//
// Reads _2026_current_suspects and _2026_active_picks as anon, and takes its
// kickoffs from js/nfl-schedule.js and its finals from js/nfl-scores.js. No new
// tables, no new grants.
(function () {
  const NOTES_CONFIG = window.FF_SUPABASE_CONFIG || {};
  const NOTES_URL = NOTES_CONFIG.url || 'https://vkoczgzizzppdrpvpemh.supabase.co';
  const NOTES_KEY = NOTES_CONFIG.publishableKey || 'sb_publishable_XfvD3zCvnCHT1v_EGE-LJA_3Z9bGjKw';
  const SUSPECTS_VIEW = NOTES_CONFIG.views?.currentSuspects || 'ff_current_suspects';
  const ACTIVE_PICKS_VIEW = NOTES_CONFIG.views?.activePicks || 'ff_active_picks';

  const SKIP_RESULT = 'SKIP';
  const NO_PICK_TEAM = 'NO PICK';
  const CENTRAL = 'America/Chicago';

  // The same three hours the wire and the scheduled scorer use. A game does not
  // publish an end time; this is the estimate all three agree on.
  const GAME_LENGTH_MS = 3 * 60 * 60 * 1000;

  // How many notes the pad shows. More than this and it stops being a glance.
  const MAX_NOTES = 5;

  const notesDb = window.supabase
    ? window.supabase.createClient(NOTES_URL, NOTES_KEY, {
        auth: {
          persistSession: true,
          // The URL belongs to js/auth-corner.js: one client reads the one-time
          // token a recovery link carries, and several racing for it is why
          // setting a new password once did nothing.
          detectSessionInUrl: false,
          storageKey: NOTES_CONFIG.storageKey || 'law-order-svu-auth-vkoczgzizzppdrpvpemh',
          storage: window.localStorage
        }
      })
    : null;

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('sergeantsNotesList')) return;
    loadNotes();
    window.addEventListener('ff-auth-changed', loadNotes);
  });

  async function loadNotes() {
    // The league's open week, not the schedule's. See js/season.js.
    await window.ffOpenWeekReady;

    if (!notesDb) {
      render(['The sergeant is off the desk.']);
      return;
    }

    const [suspects, picks, live] = await Promise.all([
      fetchSuspects(), fetchPicks(), fetchLiveScores()
    ]);
    if (suspects === null || picks === null) {
      render(['The sergeant is off the desk.']);
      return;
    }

    const board = readBoard(suspects, picks, live);
    // Forward-looking, in the order a reader wants them: what is about to be
    // decided, what would happen if it goes either way, who is still waiting,
    // who still owes a pick, and how far ahead the league has got.
    //
    // Nothing here reports a result. The Case File scoreboard counts standings
    // four inches above this pad and the Suspect Tracker shows every verdict
    // ever written - a third telling of the same story is not a note, it is
    // noise. The two backward-looking ones that survive only fire when the past
    // is genuinely remarkable: a bloodbath, or an endgame.
    const notes = [
      noteNextResolution,
      noteSwing,
      noteLastToSettle,
      noteOutstanding,
      noteNextWeek,
      noteEndgame,
      noteCarnage
    ]
      .map((write) => write(board))
      .filter(Boolean)
      .slice(0, MAX_NOTES);

    render(notes.length ? notes : ['Quiet week. Nothing worth writing down yet.']);
  }

  async function fetchSuspects() {
    const { data, error } = await notesDb
      .from(SUSPECTS_VIEW)
      .select('id, username, game_status');

    if (error) {
      console.warn("Sergeant's Notes: suspects unavailable:", error);
      return null;
    }
    return data || [];
  }

  async function fetchPicks() {
    const { data, error } = await notesDb
      .from(ACTIVE_PICKS_VIEW)
      .select('user_id, season, week, team, result');

    if (error) {
      console.warn("Sergeant's Notes: picks unavailable:", error);
      return null;
    }
    return data || [];
  }

  // The scoreboard as it stands, straight from ESPN in the browser - the same
  // module the admin's SCORE THE WEEK uses.
  //
  // Not optional dressing: without it these notes read finals out of the
  // generated js/nfl-scores.js, which is only as current as the last deploy.
  // On a Sunday afternoon that had the sergeant telling people to wait on a
  // game that finished three hours earlier. Best effort - no scoreboard just
  // means falling back to the file, which is where it was before.
  async function fetchLiveScores() {
    const week = Number(window.CURRENT_WEEK) || 1;
    const season = Number(window.SEASON) || 2026;
    if (!window.ffLiveScores?.fetchWeekCached) return [];

    try {
      return (await window.ffLiveScores.fetchWeekCached(season, week)) || [];
    } catch (error) {
      console.warn("Sergeant's Notes: no live scoreboard, using the file:", error);
      return [];
    }
  }

  // ===== WHAT THE BOARD LOOKS LIKE RIGHT NOW =====

  // One pass over the data, producing the handful of shapes every note below
  // asks about. Built once because six notes each walking the picks would be
  // six chances for two of them to disagree about the same number.
  function readBoard(suspects, picks, scoreboard = []) {
    const week = Number(window.CURRENT_WEEK) || 1;
    const season = String(window.SEASON || '');

    const out = new Set();
    const live = [];
    for (const suspect of suspects) {
      const id = String(suspect.id || '');
      if (/dun\s*dun/i.test(String(suspect.game_status || ''))) out.add(id);
      else live.push({ id, username: String(suspect.username || 'unknown') });
    }

    // This week's real picks, one per suspect, eliminated suspects excluded -
    // their season is over and their last row is not an open position.
    const byTeam = new Map();
    const filedBy = new Set();

    for (const row of picks) {
      const id = String(row?.user_id || '');
      if (!id || out.has(id)) continue;
      if (Number(row.week) !== week) continue;
      if (season && String(row.season || season) !== season) continue;
      if (String(row.result || '').trim().toUpperCase() === SKIP_RESULT) continue;

      const team = String(row.team || '').trim();
      if (!team || team === NO_PICK_TEAM) continue;

      filedBy.add(id);
      if (!byTeam.has(team)) byTeam.set(team, []);
      byTeam.get(team).push(id);
    }

    const nameOf = new Map(live.map((suspect) => [suspect.id, suspect.username]));

    // How many live suspects have already filed for the week AFTER this one.
    // Picks can be filed for any week at any time, so this exists before next
    // week does - and it is the only forward number the board cannot show.
    const nextWeekFiled = new Set(
      picks
        .filter((row) => {
          const id = String(row?.user_id || '');
          if (!id || out.has(id)) return false;
          if (Number(row.week) !== week + 1) return false;
          if (season && String(row.season || season) !== season) return false;
          if (String(row.result || '').trim().toUpperCase() === SKIP_RESULT) return false;
          const team = String(row.team || '').trim();
          return Boolean(team) && team !== NO_PICK_TEAM;
        })
        .map((row) => String(row.user_id))
    ).size;

    // The week that closed the most cases, for the one backward-looking note
    // that is allowed to exist.
    const closedPerWeek = new Map();
    for (const row of picks) {
      if (!String(row?.result || '').toUpperCase().includes('DUN DUN')) continue;
      if (season && String(row.season || season) !== season) continue;
      const w = Number(row.week);
      if (!w) continue;
      closedPerWeek.set(w, (closedPerWeek.get(w) || 0) + 1);
    }
    let worstWeek = { week: 0, count: 0 };
    for (const [w, count] of closedPerWeek) {
      if (count > worstWeek.count) worstWeek = { week: w, count };
    }

    // Every picked team with the fixture it turns on and when that is expected
    // to be over. Teams whose game has no announced kickoff are kept, with a
    // null time, so a note can still count them.
    const exposures = [...byTeam.entries()].map(([team, ids]) => {
      const info = window.NFL_SCHEDULE_HELPERS?.getTeamScheduleInfo?.(team, week);
      const game = info?.game || null;
      const kickoff = game?.kickoffUtc ? new Date(game.kickoffUtc).getTime() : null;
      // The deployed file first, then what the page just fetched. A game the
      // file has not heard about is still over.
      const score = game
        ? window.NFL_SCORE_HELPERS?.getGameForTeams?.(game.away, game.home, week) || null
        : null;
      const liveGame = game
        ? scoreboard.find((row) => row.away === game.away && row.home === game.home)
        : null;

      return {
        team,
        ids,
        count: ids.length,
        names: ids.map((id) => nameOf.get(id)).filter(Boolean),
        opponent: info?.opponent || '',
        kickoff,
        endsAt: kickoff ? kickoff + GAME_LENGTH_MS : null,
        settled: Boolean(score?.final) || Boolean(liveGame?.final)
      };
    });

    return {
      week,
      live,
      nextWeekFiled,
      worstWeek,
      outCount: out.size,
      filed: [...filedBy],
      unfiled: live.filter((suspect) => !filedBy.has(suspect.id)),
      exposures,
      // Only the ones still to be decided; a finished game is not something to
      // wait for.
      pending: exposures.filter((exposure) => !exposure.settled)
    };
  }

  // ===== THE NOTES =====

  // Who is left waiting longest, and on what. The interesting version of this is
  // when it is one or two people on a night game while everybody else is done -
  // so it only writes itself when the last slot is a genuine outlier.
  function noteLastToSettle(board) {
    const timed = board.pending.filter((exposure) => exposure.endsAt);
    if (!timed.length) return '';

    const last = Math.max(...timed.map((exposure) => exposure.endsAt));
    const latest = timed.filter((exposure) => exposure.endsAt === last);
    const waiting = latest.reduce((total, exposure) => total + exposure.count, 0);
    const stillPending = timed.reduce((total, exposure) => total + exposure.count, 0);

    // Everybody is on the same game: that is not somebody waiting late, that is
    // the whole league waiting, which noteNextResolution says better.
    if (waiting === stillPending) return '';

    const who = namesOrCount(latest.flatMap((exposure) => exposure.names), waiting);
    const fixtures = latest
      .map((exposure) => exposure.opponent ? `${short(exposure.team)}/${short(exposure.opponent)}` : short(exposure.team))
      .join(' and ');

    return `${who} ${waiting === 1 ? 'is' : 'are'} last on the board - ${fixtures} ` +
      `${latest.length === 1 ? 'does not' : 'do not'} finish until about ` +
      `${timeWord(last)} ${dayWord(last)}.`;
  }

  // The single result still to come that moves the most cases, said both ways.
  // Pending games only: a team whose game is already final decides nothing, and
  // "23 picks ride on the Cardinals" was counting settled exposure as if the
  // league were still waiting on it.
  //
  // The direction matters and is easy to get backwards. A suspect names a team
  // they expect to LOSE, so the opponent winning is the good outcome: the
  // accused team going down is what lets them walk.
  function noteSwing(board) {
    const open = board.pending.filter((exposure) => exposure.count > 1 && exposure.opponent);
    if (!open.length) return '';

    const biggest = open.reduce((best, exposure) =>
      exposure.count > best.count ? exposure : best);

    const stillOpen = board.pending.reduce((total, exposure) => total + exposure.count, 0);
    // One game carrying two of the thirty still open is not a swing.
    if (biggest.count < 3 && biggest.count / Math.max(1, stillOpen) < 0.25) return '';

    const when = biggest.endsAt ? ` by about ${timeWord(biggest.endsAt)} ${dayWord(biggest.endsAt)}` : '';
    const cases = biggest.count === 1 ? 'case' : 'cases';

    return `${biggest.count} ${cases} turn on one game: the ${short(biggest.opponent)} ` +
      `beat the ${short(biggest.team)}${when} and all ${biggest.count} walk - ` +
      `the ${short(biggest.team)} win and all ${biggest.count} close.`;
  }

  // What the next few hours actually decide.
  function noteNextResolution(board) {
    const timed = board.pending.filter((exposure) => exposure.endsAt);
    if (!timed.length) return '';

    const next = Math.min(...timed.map((exposure) => exposure.endsAt));
    const settling = timed
      .filter((exposure) => exposure.endsAt === next)
      .reduce((total, exposure) => total + exposure.count, 0);

    if (settling < 2) return '';

    const stillPending = timed.reduce((total, exposure) => total + exposure.count, 0);
    // "every open case settles" but "14 of the 35 still open settle" - the verb
    // has to follow the subject, and the subject changes shape here.
    const all = settling === stillPending;
    const share = all ? 'Every open case' : `${settling} of the ${stillPending} still open`;

    return `${share} ${all ? 'settles' : 'settle'} around ${timeWord(next)} ${dayWord(next)}.`;
  }

  // Who has not filed, and how long they have. The deadline is the last kickoff
  // of the week - after that a missing pick is an elimination.
  function noteOutstanding(board) {
    if (!board.unfiled.length) return '';

    const kickoffs = (window.NFL_SCHEDULE_HELPERS?.getWeekGames?.(board.week) || [])
      .map((game) => (game.kickoffUtc ? new Date(game.kickoffUtc).getTime() : null))
      .filter(Boolean);

    const deadline = kickoffs.length ? Math.max(...kickoffs) : null;
    const who = namesOrCount(board.unfiled.map((suspect) => suspect.username), board.unfiled.length);
    const by = deadline && deadline > Date.now()
      ? ` until ${timeWord(deadline)} ${dayWord(deadline)}`
      : '';

    return `${who} ${board.unfiled.length === 1 ? 'has' : 'have'} not named a victim for ` +
      `Week ${board.week}${by}.`;
  }

  // How far ahead the league has got. Picks can be filed for any week at any
  // time, so this is the one number about NEXT week that exists before next
  // week does - and it is the thing a reader can act on right now.
  function noteNextWeek(board) {
    const ahead = board.nextWeekFiled;
    const live = board.live.length;
    if (!live) return '';

    if (!ahead) {
      return `Nobody has named a victim for Week ${board.week + 1} yet. ` +
        'Picks can be filed for any week at any time.';
    }

    if (ahead === live) return `Every suspect has already filed for Week ${board.week + 1}.`;

    return `${ahead} of ${live} have already filed for Week ${board.week + 1}.`;
  }

  // The endgame. Only worth a line once the number is small enough to be the
  // whole story - at twenty-two still walking this is just the scoreboard again.
  function noteEndgame(board) {
    const standing = board.live.length;
    if (!standing || standing > 4) return '';

    if (standing === 1) return 'One suspect left. That is the season.';
    return `${spell(standing)} suspects left. Any week now this ends.`;
  }

  // A week that took out a quarter of the field or more. Backward-looking, and
  // allowed to be, because it is the one thing about a finished week that a
  // reader would not get from looking at the board: not who went out, but that
  // the week was a bloodbath.
  function noteCarnage(board) {
    const { week, count } = board.worstWeek;
    if (!count) return '';

    const field = count + board.live.length;
    if (count < 3 || count / Math.max(1, field) < 0.25) return '';

    return `Week ${week} took ${count} of them out at once.`;
  }

  // ===== SAYING IT =====

  // Up to three names, then a count. "4thewin and YNWA" reads; a list of
  // nineteen handles does not, and the board above already carries them.
  function namesOrCount(names, count) {
    const clean = names.filter(Boolean);
    if (!clean.length) return `${count} ${count === 1 ? 'suspect' : 'suspects'}`;
    if (clean.length === 1) return clean[0];
    if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
    if (clean.length === 3) return `${clean[0]}, ${clean[1]} and ${clean[2]}`;
    return `${clean.length} suspects`;
  }

  // Last word of the club name: Los Angeles Chargers -> Chargers.
  function short(team) {
    const parts = String(team || '').trim().split(/\s+/);
    return parts.length ? parts[parts.length - 1] : '';
  }

  function timeWord(at) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: CENTRAL, hour: 'numeric', minute: '2-digit'
    }).format(new Date(at)).toLowerCase();
  }

  // today / tomorrow / the weekday, measured on the Central calendar rather than
  // the reader's - a visitor on the west coast at 11pm should not be told
  // "tomorrow" about a game that for them is tonight.
  function dayWord(at) {
    const when = new Date(at);
    const days = centralDay(when) - centralDay(new Date());
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    return `on ${new Intl.DateTimeFormat('en-US', { timeZone: CENTRAL, weekday: 'long' }).format(when)}`;
  }

  function centralDay(when) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: CENTRAL, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(when);
    return Math.floor(Date.parse(parts + 'T00:00:00Z') / 86400000);
  }

  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];
  const spell = (n) => WORDS[n] || String(n);

  function render(notes) {
    const list = document.getElementById('sergeantsNotesList');
    if (!list) return;

    list.innerHTML = notes
      .map((note) => `<li class="sergeants-note">${escapeHtml(note)}</li>`)
      .join('');
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
