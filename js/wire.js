// ===== WIRE =====
// The squad room radio: every suspect on the board, what the week has done to
// them so far, and the two teams whose game decides it. One long strip, read
// left to right, the way a wire is.
//
// Three things go into a line and they answer three different questions:
//   1. the suspect's standing   - are they still in the game at all
//   2. their pick for the week  - have they filed, and what happened to it
//   3. the fixture              - who is playing, with what record, and when
//
// Everything here is read-only and public. The page signs nobody in, so it runs
// as anon and asks for nothing anon cannot have.
(function () {
  const WIRE_CONFIG = window.FF_SUPABASE_CONFIG || {};
  const WIRE_URL = WIRE_CONFIG.url || 'https://vkoczgzizzppdrpvpemh.supabase.co';
  const WIRE_KEY = WIRE_CONFIG.publishableKey || 'sb_publishable_XfvD3zCvnCHT1v_EGE-LJA_3Z9bGjKw';
  const SUSPECTS_VIEW = WIRE_CONFIG.views?.currentSuspects || 'ff_current_suspects';
  const PICKS_VIEW = WIRE_CONFIG.views?.activePicks || 'ff_active_picks';
  const RUNS_TABLE = WIRE_CONFIG.tables?.scoreRuns || '_2026_score_runs';

  // Seconds of travel per entry. Fixed per entry rather than per strip, so a
  // forty-suspect wire reads at the same speed as a four-suspect one.
  const SECONDS_PER_ITEM = 9;

  // Roughly what an entry travels at, used for the standalone phrases - Loading,
  // Radio is down - where there is no entry count to scale by.
  const MESSAGE_PIXELS_PER_SECOND = 120;

  // The scorer's row for a week nobody filed. It is a verdict, not a pick, and
  // must never be read out as one.
  const NO_PICK_TEAM = 'NO PICK';

  // Every time this site says out loud is said in Central, the zone the
  // kickoffs are given in, so two times on one page can never be an hour apart
  // for no visible reason.
  const CENTRAL = 'America/Chicago';
  const SKIP_RESULT = 'SKIP';

  // Written by js/admin-score.js when a week is committed. The value is only a
  // timestamp; what matters is that it changed.
  const WEEK_SCORED_KEY = 'ff-week-scored-at';

  const wireDb = window.supabase
    ? window.supabase.createClient(WIRE_URL, WIRE_KEY, {
        auth: {
          persistSession: true,
          // The recovery link's one-time token belongs to js/auth-corner.js
          // alone. Several clients racing for it is why setting a new password
          // used to do nothing.
          detectSessionInUrl: false,
          storageKey: WIRE_CONFIG.storageKey || 'law-order-svu-auth-vkoczgzizzppdrpvpemh',
          storage: window.localStorage
        }
      })
    : null;

  // The signed-in suspect's id, or '' for a passer-by. Only decides whether a
  // face on the strip is your own, and so whether its preview offers the rap
  // sheet. Same name and same job as the one in js/suspect-lineup-chart.js.
  let viewerId = '';

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('wireTrack')) return;
    loadWire();
    window.addEventListener('ff-auth-changed', loadWire);

    // Scoring a week happens in the admin tab, and rewrites the results every
    // sentence on this strip is built from. The storage event fires in the
    // OTHER tabs of an origin, which is exactly the reach wanted: the admin
    // page has no wire on it, and this one cannot know to re-read without
    // being told. See js/admin-score.js.
    window.addEventListener('storage', (event) => {
      if (event.key === WEEK_SCORED_KEY) loadWire();
    });
  });

  // Everything the wire has to say, it says on the wire. There is no status line
  // over or under it and no toast beside it: waiting, failing and having nothing
  // to report are all just what the strip is carrying at that moment.
  async function loadWire() {
    // The league's open week, not the schedule's. See js/season.js.
    await window.ffOpenWeekReady;

    if (!wireDb) {
      runMessage('Radio is down.');
      return;
    }

    runMessage('Wire loading...');

    // Which face is the viewer's own, so clicking it here offers Edit Rap
    // Sheet exactly as it does on the board below.
    const session = await wireDb.auth.getUser().catch(() => null);
    const user = session?.data?.user || null;
    viewerId = user?.id || '';

    const [suspects, picks] = await Promise.all([fetchSuspects(Boolean(user)), fetchPicks()]);
    if (suspects === null || picks === null) {
      runMessage('Radio is down.');
      return;
    }

    // Needs the picks first, to know which games are anybody's business here.
    const snapshot = await fetchSnapshot(picks);
    // Read by fixtureFor while the entries below are built, so a result the
    // deployed scoreboard file has not caught up with still reads as a score.
    liveGames = snapshot;

    const entries = buildEntries(suspects, picks);
    if (!entries.length) {
      runMessage('Nobody on the board yet.');
      return;
    }

    render(entries, snapshot);
    watchWhen();
    stampScores(await fetchLastScored());
  }

  // What the strip says when there is nothing to say yet, or nothing to say at
  // all. A blank black band reads as broken; a band saying "Radio is down."
  // reads as a radio that is down.
  function runMessage(text) {
    const track = document.getElementById('wireTrack');
    if (!track) return;

    const item = `<span class="wire-item"><span class="wire-pending">${escapeHtml(text)}</span></span>`;
    const perHalf = Math.max(6, Math.ceil((window.innerWidth || 1200) / 140) + 2);

    track.innerHTML = item.repeat(perHalf * 2);
    // The note under the wire says the same thing the wire is saying. It is
    // the line that will carry the scoreboard's age once there is a scoreboard
    // to be old, and leaving it blank until then made the page shift.
    setStamp(text);

    const list = document.getElementById('wireList');
    if (list) list.innerHTML = '';

    // Matched to the speed the real entries travel at, so the strip does not
    // visibly change gear when the data lands.
    runWire(track, Math.max(8, (track.scrollWidth / 2) / MESSAGE_PIXELS_PER_SECOND));
  }

  // When SCORE THE WEEK was last run, which is when these sentences last
  // changed. _2026_score_runs and not _2026_picks.scored_at: the column on the
  // pick row was backfilled from created_at for everything already judged, so
  // for those rows it holds the moment the PICK WAS FILED - which produced a
  // wire dated an hour before the week's first kickoff. The runs table is only
  // ever written by a commit actually happening, so it has nothing to be wrong
  // about. Forgiving, because the table arrives with ff_score_week.sql and
  // asking for one that is not there yet fails the request.
  async function fetchLastScored() {
    const { data, error } = await wireDb
      .from(RUNS_TABLE)
      .select('last_run_at')
      .order('last_run_at', { ascending: false })
      .limit(1);

    if (error) {
      console.warn('No scoring runs on file; dating the wire from the scoreboard instead:', error);
      return null;
    }

    const at = data?.[0]?.last_run_at ? new Date(data[0].last_run_at) : null;
    return at && !Number.isNaN(at.getTime()) ? at : null;
  }

  // ===== SAYING WHEN =====

  // A football game runs about three hours. Nothing in the schedule says when a
  // game ENDS - only when it starts - so three hours after kickoff is the
  // estimate, and every line built on it says "approx" because that is what it
  // is. The scheduled scorer in supabase/sql/ff_auto_score.sql uses the same
  // three hours, so the page and the job agree about when the news is due.
  const GAME_LENGTH_MS = 3 * 60 * 60 * 1000;

  function centralTime(when) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: CENTRAL, hour: 'numeric', minute: '2-digit'
    }).format(when).toLowerCase();
  }

  // today / tomorrow / the date itself, all measured against the Central
  // calendar day rather than the browser's - or a reader on the west coast at
  // 11pm is told "tomorrow" about a game that for them is tonight.
  function dayWord(when) {
    const days = centralDayNumber(when) - centralDayNumber(new Date());
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';

    const part = (options) =>
      new Intl.DateTimeFormat('en-US', { timeZone: CENTRAL, ...options }).format(when);
    const day = Number(part({ day: 'numeric' }));
    return `on ${part({ weekday: 'long' })}, ${part({ month: 'long' })} ${day}${ordinal(day)}`;
  }

  // Days since epoch on the Central calendar. Comparing the date PARTS is the
  // point: "tomorrow" means the next calendar day there, which is not the same
  // as "in 24 hours" and is not the same as the next calendar day here.
  function centralDayNumber(when) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: CENTRAL, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(when);
    return Math.floor(Date.parse(parts + 'T00:00:00Z') / 86400000);
  }

  function ordinal(day) {
    const teens = day % 100;
    if (teens >= 11 && teens <= 13) return 'th';
    return ['th', 'st', 'nd', 'rd'][day % 10] || 'th';
  }

  // Live, because the day word has to roll from "today" to "tomorrow" at
  // midnight on a page somebody left open. A minute is fine - nothing else on
  // the strip changes without a reload.
  //
  // Rewritten in place rather than by re-rendering, because the strip is a
  // moving object: rebuilding it would jump the travel back to wherever the new
  // track happened to start, once a minute, forever.
  let whenTimer = null;

  function watchWhen() {
    clearInterval(whenTimer);
    whenTimer = setInterval(repaintWhen, 60 * 1000);
  }

  function repaintWhen() {
    for (const el of document.querySelectorAll('[data-wire-at]')) {
      const at = Number(el.dataset.wireAt);
      if (!at) continue;
      const when = new Date(at);
      el.textContent = el.dataset.wirePart === 'time' ? centralTime(when) : dayWord(when);
    }
  }

  // first_name is ASKED FOR ONLY WHEN SIGNED IN, and that is not an
  // optimisation. `anon` has no grant on that column, and PostgREST fails the
  // whole select rather than returning the rest - so naming it unconditionally
  // took down the entire strip for every signed-out visitor, which is most of
  // them, and the only symptom was "Radio is down." Same shape as
  // fetchProfiles(showFirstNames) in js/suspect-lineup-chart.js.
  //
  // It is here at all so this strip's preview carries the same second line the
  // corkboard's does: one popup, one caption, whichever copy of a face was
  // clicked.
  async function fetchSuspects(showFirstNames) {
    const columns = showFirstNames
      ? 'id, username, first_name, avatar_data_url, game_status'
      : 'id, username, avatar_data_url, game_status';

    const { data, error } = await wireDb
      .from(SUSPECTS_VIEW)
      .select(columns);

    if (error) {
      console.error('Wire: suspects unavailable:', error);
      return null;
    }
    return data || [];
  }

  async function fetchPicks() {
    const { data, error } = await wireDb
      .from(PICKS_VIEW)
      .select('user_id, season, week, team, result');

    if (error) {
      console.error('Wire: picks unavailable:', error);
      return null;
    }
    return data || [];
  }

  // ===== WHAT EACH SUSPECT IS ON =====

  // The same rule the lineup uses: survive the week being played and the week
  // you are waiting on is the next one. Kept in step with js/suspects.js on
  // purpose - two pages disagreeing about which week somebody is on would be
  // worse than either being wrong.
  function buildEntries(suspects, picks) {
    const thisWeek = Number(window.CURRENT_WEEK) || 1;
    const season = String(window.SEASON || '');
    const byUser = new Map();

    for (const row of picks) {
      const id = String(row?.user_id || '');
      const week = Number(row?.week);
      if (!id || !week) continue;
      if (season && String(row.season || season) !== season) continue;
      if (String(row.result || '').trim().toUpperCase() === SKIP_RESULT) continue;
      if (!byUser.has(id)) byUser.set(id, new Map());
      byUser.get(id).set(week, row);
    }

    return suspects
      .map((suspect) => {
        const filed = byUser.get(String(suspect.id || '')) || new Map();
        const status = String(suspect.game_status || suspect.status || 'SUSPECT').toUpperCase();
        const isOut = status.includes('DUN DUN');

        // A closed case has no next pick, so the wire reports the one that
        // closed it - the week carrying the DUN DUN, not merely the last week
        // on file. Everyone else is reported on the week they owe.
        const cleared = String(filed.get(thisWeek)?.result || '').toUpperCase().includes('SURVIVED');
        const week = isOut ? closingWeek(filed, thisWeek) : (cleared ? thisWeek + 1 : thisWeek);
        const row = filed.get(week) || null;
        const pick = realPick(row);

        return {
          id: suspect.id || '',
          username: String(suspect.username || 'unknown'),
          firstName: String(suspect.first_name || ''),
          avatar: suspect.avatar_data_url || '',
          isOut,
          week,
          pick,
          // Out with a NO PICK row against them: the week ran out, not the
          // wrong team won. Two different sentences.
          neverFiled: isOut && Boolean(row) && !pick,
          fixture: pick ? fixtureFor(pick.team, week) : null,
          // Through the live week already, which is what moved them on to the
          // next one. Carried because it is what separates somebody waiting on
          // a week they have already earned from somebody who has simply not
          // filed yet - two different bands on the lineup board.
          cleared,
          // What got them this far. A closed case does not need it - its own
          // sentence is about how it ended, not how it lasted.
          prior: isOut ? null : priorSurvival(filed, week)
        };
      })
      // The same order the Suspects board reads in, band for band: closed
      // cases, then anyone the clock is running on, then anyone already through
      // to next week, then the picks still waiting on Sunday. Alphabetical
      // inside a band. Kept in step with lineupBand() in js/suspects.js - the
      // two pages showing the same roster in different orders would be worse
      // than either order being wrong.
      .sort((a, b) => wireBand(a) - wireBand(b) ||
        a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }));
  }

  // Which band of the wire a suspect sits in, in the order they are read out.
  // The same four the Suspects board sorts into, and the same rule for picking
  // one: out, filed, through, or still owing.
  const BAND_CLOSED = 0;
  const BAND_WAITING = 1;
  const BAND_CLEARED = 2;
  const BAND_FILED = 3;

  function wireBand(entry) {
    if (entry.isOut) return BAND_CLOSED;
    if (entry.pick) return BAND_FILED;
    return entry.cleared ? BAND_CLEARED : BAND_WAITING;
  }

  // The week the case closed on. The DUN DUN row is the answer where there is
  // one; the newest week on file is the fallback, for a suspect marked out by
  // hand or by something the scorer has not written a row for yet.
  function closingWeek(filed, fallback) {
    let closing = null;

    for (const [week, row] of filed) {
      if (!String(row?.result || '').toUpperCase().includes('DUN DUN')) continue;
      if (closing === null || week < closing) closing = week;
    }
    if (closing !== null) return closing;

    const weeks = [...filed.keys()];
    return weeks.length ? Math.max(...weeks) : fallback;
  }

  // The most recent week this suspect came through, and the game that did it.
  // Nothing for anyone still on Week 1, who has not come through anything yet.
  function priorSurvival(filed, beforeWeek) {
    let best = null;

    for (const [week, row] of filed) {
      if (week >= beforeWeek) continue;
      if (!String(row?.result || '').toUpperCase().includes('SURVIVED')) continue;
      if (!best || week > best.week) best = { week, pick: row };
    }
    if (!best) return null;

    best.fixture = fixtureFor(best.pick.team, best.week);
    return best;
  }

  // NO PICK is the scorer's verdict on a week nobody filed. It is a row in the
  // picks table but it is not a pick, and reading it out as one would have the
  // wire announcing that somebody accused a team called NO PICK.
  function realPick(row) {
    if (!row) return null;
    if (String(row.team || '').trim().toUpperCase() === NO_PICK_TEAM) return null;
    return row;
  }

  // ===== THE FIXTURE =====

  // Both teams in the game the pick turns on, each with the record they carry
  // into it, plus whatever the scoreboard says about the game itself.
  function fixtureFor(team, week) {
    const info = window.NFL_SCHEDULE_HELPERS?.getTeamScheduleInfo?.(team, week);
    if (!info || info.isBye || !info.opponent) return null;

    const game = info.game;
    const away = game?.away || (info.homeAway === '@' ? team : info.opponent);
    const home = game?.home || (info.homeAway === '@' ? info.opponent : team);
    // The generated file first, then the scoreboard this page just fetched.
    // js/nfl-scores.js is only as current as the last deploy, and a final it has
    // not heard about is what made closed cases print "did not lose" instead of
    // the score that closed them.
    const score = window.NFL_SCORE_HELPERS?.getGameForTeams?.(away, home, week)
      || liveScoreFor(away, home);

    return {
      away,
      home,
      score,
      // When the game is expected to be OVER, which is what the strip says.
      // Null for a flex-scheduled week with no announced kickoff yet.
      endsAt: endOfGame(game?.kickoffUtc),
      isTbd: Boolean(info.isTbd)
    };
  }

  // The finished games from this page's own fetch, shaped like the entries in
  // js/nfl-scores.js so fixtureFor can use either without knowing which.
  let liveGames = [];

  function liveScoreFor(away, home) {
    const game = liveGames.find((row) =>
      row.final && row.away === away && row.home === home);
    if (!game) return null;

    return {
      away: game.away,
      home: game.home,
      awayScore: Number(game.awayPoints),
      homeScore: Number(game.homePoints),
      final: true
    };
  }

  // Kickoff plus the three hours a game runs. The same arithmetic the check-back
  // entry does, deliberately: the strip should not tell one suspect their game
  // is settled at 6:25 and then tell the room to come back at 6:20.
  function endOfGame(kickoffUtc) {
    const at = kickoffUtc ? new Date(kickoffUtc) : null;
    if (!at || Number.isNaN(at.getTime())) return null;
    return at.getTime() + GAME_LENGTH_MS;
  }


  // Last word of the name: San Francisco 49ers -> 49ers. The closed-case line
  // names both clubs twice over in one breath, and the full names made it read
  // like a fixture list rather than a sentence.
  function shortName(team) {
    const parts = String(team || '').trim().split(/\s+/);
    return parts.length ? parts[parts.length - 1] : '';
  }

  // ===== THE LINE =====

  function statusHtml(entry) {
    return entry.isOut
      ? '<span class="wire-flag wire-flag-out">Case Closed</span>'
      : '<span class="wire-flag wire-flag-live">Still A Suspect</span>';
  }

  // Two sentences for a suspect still in it. The first says why they are still
  // here: the team they accused of losing did lose, and by what. The second says
  // where they stand on the week in front of them. Split because they are two
  // different facts about two different weeks, and running them together as one
  // clause made the line read as though the pick and the result were the same
  // thing.
  // "(SEAHAWKS 13 OVER PATRIOTS 10)" - the result that let them through, said as
  // the scoreline rather than as a sentence about it. Winner first, because that
  // is the way a score is read out loud.
  //
  // Only shown when they have not filed for the open week. Somebody who has
  // survived and already named their next victim gets the fixture parenthetical
  // instead: two brackets in one line reads as a typo, and the newer of the two
  // facts is the one worth the space.
  function survivalHtml(entry) {
    const prior = entry.prior;
    // Nothing at all, not even a full stop: with a pick filed, the fixture
    // clause continues this sentence and closes it, and a stop here landed in
    // the middle of the line - "IS STILL A SUSPECT . (CHARGERS OVER CARDINALS)".
    if (!prior || entry.pick) return '';

    const victim = prior.pick.team;
    const f = prior.fixture;
    const score = f?.score?.final ? f.score : null;

    // Marked as having survived with no final on file for the game: the
    // scoreboard is behind. Say only what is known.
    if (!f || !score) {
      return ` <span class="wire-paren">(survived Week ${prior.week})</span>`;
    }

    const opponent = f.away === victim ? f.home : f.away;
    const victimScore = Number(f.away === victim ? score.awayScore : score.homeScore);
    const opponentScore = Number(f.away === victim ? score.homeScore : score.awayScore);

    return ` <span class="wire-paren">(<span class="wire-side">${escapeHtml(shortName(opponent))}</span>
      <span class="wire-state-final">${opponentScore}</span> over
      <span class="wire-victim">${escapeHtml(shortName(victim))}</span>
      <span class="wire-state-final">${victimScore}</span>)</span>`;
  }

  // The second sentence: the week in front of them. Filed, it names the accused,
  // who they have to lose to, and when the game is - the whole fixture said as a
  // sentence, which is what replaced the boxed-off scoreboard line that used to
  // sit at the end of every entry saying the same thing twice.
  // Nothing about an unfiled week here. A suspect who owes one and has no result
  // to report gets no entry at all - thirty lines saying the same sentence with
  // a different name was thirty laps of the strip to learn one fact.
  function nextPickHtml(entry) {
    if (!entry.pick) return '';

    const f = entry.fixture;
    const victim = entry.pick.team;
    const opponent = f ? (f.away === victim ? f.home : f.away) : '';

    // "(CHARGERS OVER CARDINALS)" - who has to beat their pick, in the same
    // shape the finished result is given in, so a line before the game and the
    // same line after it read as the same statement with the numbers filled in.
    const fixture = opponent
      ? ` <span class="wire-paren">(<span class="wire-side">${escapeHtml(shortName(opponent))}</span>
          over <span class="wire-victim">${escapeHtml(shortName(victim))}</span>)</span>`
      : ` <span class="wire-paren">(<span class="wire-victim">${escapeHtml(shortName(victim))}</span>
          on a bye)</span>`;

    let head = fixture;

    if (f?.endsAt) {
      head += ` <span class="wire-pending">Check back approx</span>
        ${whenSpan(f.endsAt, 'time')}
        <span class="wire-because">central</span>
        ${whenSpan(f.endsAt, 'day')}`;
    } else if (f) {
      head += ` <span class="wire-pending">Check back</span>
        <span class="wire-because">once the game has a time</span>`;
    }

    // Only ever reached out of order: a survived week rolls the suspect on to
    // the next one and a DUN DUN closes the case, so an open week carrying a
    // result at all means something upstream is out of step. Say so rather than
    // reporting a decided game as pending.
    const result = String(entry.pick.result || '').trim().toUpperCase();
    if (result.includes('SURVIVED')) {
      head += '<span class="wire-verdict-good">Survived</span>';
    } else if (result.includes('DUN DUN')) {
      head += '<span class="wire-verdict-bad">Dun Dun</span>';
    }

    return head;
  }

  // A time or a day carried on the element that prints it, so the minute tick
  // can rewrite it without rebuilding the strip. The time never changes; the day
  // does, at midnight, on a page somebody left open.
  function whenSpan(at, part) {
    const when = new Date(at);
    const text = part === 'time' ? centralTime(when) : dayWord(when);
    return `<span class="wire-when" data-wire-at="${at}" data-wire-part="${part}">` +
      `${escapeHtml(text)}</span>`;
  }


  // ===== THE LINE =====


  // No full stops on the strip. Each entry is one statement with a wide gap
  // either side of it, and a running feed is not prose - the mark was doing
  // nothing the space was not already doing. The roll call under the strip
  // keeps its sentences: that one is read aloud, where the punctuation is what
  // tells a screen reader where to breathe.

  // A closed case, told from the suspect's own pick outwards rather than from
  // the winner in: the team they accused of losing put up a score and did not
  // lose, and here is what the other side managed. That is the shape of the
  // grievance - the pick is the subject, not the scoreline.
  //
  // "Only" is safe because a suspect is out precisely when their pick did not
  // lose, so the opponent's score can never be the higher of the two. A draw is
  // the one case where it would read wrong, and says "also" instead.
  // The suspect's own booking card, the same mark the Suspect Tracker puts in
  // front of every row: their photograph in a framed box carrying the placard
  // stripe, and their name on a plate tinted with the two colours sampled from
  // that photograph. js/suspect-colors.js resolves the pair; paintMugs() below
  // puts it on.
  //
  // Clicking one opens the same preview the corkboard and the tracker open,
  // from the same builder - see js/mugshot-lightbox.js. No tabindex: the strip
  // is aria-hidden and duplicated for the loop, so a focus stop here would put
  // two of every suspect in the tab order of a thing a screen reader is being
  // told to ignore. The .sr-only list beside it and the board below are the
  // accessible route to the same faces.
  function mugHtml(entry) {
    const shot = entry.avatar
      ? `<img class="wire-mug-shot" src="${escapeHtml(entry.avatar)}" alt="" width="30" height="30"/>`
      : '';

    const mugAttrs = window.ffSuspectMugshotAttrs?.({
      username: entry.username,
      firstName: entry.firstName,
      avatarSrc: entry.avatar,
      isSelf: Boolean(entry.id) && entry.id === viewerId
    }) || '';

    return `<span class="wire-mug" ${mugAttrs} data-username="${escapeHtml(entry.username)}">
      <span class="wire-mug-frame">${shot}</span>
      <span class="wire-name">${escapeHtml(entry.username)}</span>
    </span>`;
  }

  // "CASE CLOSED KATNOLA (BECAUSE 49ERS WON)." The long version spelled out both
  // scores and read like a match report; a closed case is a headline, and the
  // board and the legal pad both carry the detail for anybody who wants it.
  // "CASE CLOSED KATNOLA (49ERS OVER RAMS)." The same bracketed matchup the rest
  // of the strip uses, so a result reads the same shape whichever way it went -
  // the only difference is whose name is in front of "over".
  //
  // Their pick is always the one on the left: a case closes precisely because
  // the team they accused did not lose.
  function closedHtml(entry) {
    // The suspect leads, the way every other entry on the strip does. CASE
    // CLOSED used to come first, which read as a stamp but meant a reader
    // scanning for a name found a label on one line in five and had to look
    // past it. One shape for every line that is about a person.
    const head = `${mugHtml(entry)} <span class="wire-gone">case closed</span>`;

    if (entry.neverFiled || !entry.pick) {
      return `${head} <span class="wire-paren">(<span class="wire-pick-none">no victim named</span>)</span>`;
    }

    const victim = shortName(entry.pick.team);
    const f = entry.fixture;
    const opponent = f ? shortName(f.away === entry.pick.team ? f.home : f.away) : '';
    const score = f?.score?.final ? f.score : null;

    // No opponent on file at all, or no final for the game - the scoreboard is
    // behind. Say the one thing that is known rather than inventing a matchup.
    // No score on file for the game that ended them - neither the deployed
    // scoreboard nor this page's own fetch has it, which happens for a week
    // older than the one being fetched. The matchup is still known and still
    // true: a case closes precisely because the accused team did not lose, so
    // their name goes on the left exactly as it would with a score beside it.
    if (!score) {
      return opponent
        ? `${head} <span class="wire-paren">(<span class="wire-victim">${escapeHtml(victim)}</span>
            over <span class="wire-side">${escapeHtml(opponent)}</span>)</span>`
        : `${head} <span class="wire-paren">(<span class="wire-victim">${escapeHtml(victim)}</span>
            did not lose)</span>`;
    }

    // A tie closes a case the same as a win, and "over" would be wrong about the
    // one fact this line carries.
    const mine = Number(f.away === entry.pick.team ? score.awayScore : score.homeScore);
    const theirs = Number(f.away === entry.pick.team ? score.homeScore : score.awayScore);
    // A draw closes a case the same as a win - the accused team did not lose,
    // which is the whole test - but "BEARS OVER PACKERS" would be a lie about
    // the one fact this line carries, and a bare "TIED" reads as a score line
    // rather than as the verb between two clubs.
    const verb = mine === theirs ? 'tied with' : 'over';

    return `${head} <span class="wire-paren">(<span class="wire-victim">${escapeHtml(victim)}</span>
      <span class="wire-verdict-bad">${verb}</span>
      <span class="wire-side">${escapeHtml(opponent)}</span>)</span>`;
  }

  function itemHtml(entry) {
    const body = entry.isOut
      ? closedHtml(entry)
      : `${mugHtml(entry)}
         <span class="wire-is">is</span>
         ${statusHtml(entry)}
         ${survivalHtml(entry)}
         ${nextPickHtml(entry)}`;

    // Nothing between entries and nothing closing them. The gap either side is
    // the break.
    return `<span class="wire-item${entry.isOut ? ' wire-item-out' : ''}">${body}</span>`;
  }

  // The same entry as a sentence, for the static list under the strip. A
  // marquee is a miserable thing to read with a screen reader, so the strip is
  // aria-hidden and this is what is actually announced.
  function lineText(entry) {
    if (entry.isOut) return closedText(entry);

    const head = `${entry.username} is Still A Suspect`;
    if (!entry.pick) return `${head}${priorText(entry)}`;

    const f = entry.fixture;
    const victim = shortName(entry.pick.team);
    const opponent = f ? shortName(f.away === entry.pick.team ? f.home : f.away) : '';

    let line = opponent
      ? `${head} (${opponent} over ${victim}).`
      : `${head} (${victim} on a bye).`;

    if (f?.endsAt) {
      const when = new Date(f.endsAt);
      line += ` Check back approx ${centralTime(when)} central ${dayWord(when)}.`;
    } else if (f) {
      line += ' Check back once the game has a time.';
    }

    const result = String(entry.pick.result || '').trim().toUpperCase();
    if (result.includes('SURVIVED')) return `${line} Survived.`;
    if (result.includes('DUN DUN')) return `${line} Dun dun.`;
    return line;
  }

  function priorText(entry) {
    const prior = entry.prior;
    if (!prior) return '.';

    const victim = shortName(prior.pick.team);
    const f = prior.fixture;
    const score = f?.score?.final ? f.score : null;
    if (!f || !score) return ` (survived Week ${prior.week}).`;

    const opponent = shortName(f.away === prior.pick.team ? f.home : f.away);
    const victimScore = Number(f.away === prior.pick.team ? score.awayScore : score.homeScore);
    const opponentScore = Number(f.away === prior.pick.team ? score.homeScore : score.awayScore);

    return ` (${opponent} ${opponentScore} over ${victim} ${victimScore}).`;
  }

  function closedText(entry) {
    const head = entry.username + ' case closed';

    if (entry.neverFiled || !entry.pick) return `${head}: no victim named.`;

    const victim = shortName(entry.pick.team);
    const f = entry.fixture;
    const opponent = f ? shortName(f.away === entry.pick.team ? f.home : f.away) : '';
    const score = f?.score?.final ? f.score : null;
    if (!score) {
      return opponent ? `${head} (${victim} over ${opponent}).`
                      : `${head}: the ${victim} did not lose.`;
    }

    const mine = Number(f.away === entry.pick.team ? score.awayScore : score.homeScore);
    const theirs = Number(f.away === entry.pick.team ? score.homeScore : score.awayScore);
    return `${head} (${victim} ${mine === theirs ? 'tied with' : 'over'} ${opponent}).`;
  }
  // The NFL scoreboard for the open week, straight from ESPN in the browser -
  // the same source and the same module the admin's SCORE THE WEEK uses. Best
  // effort by design: no scoreboard just means no snapshot entries, and the rest
  // of the strip is about the league rather than about the games.
  async function fetchSnapshot(picks) {
    const week = Number(window.CURRENT_WEEK) || 1;
    const season = Number(window.SEASON) || 2026;
    if (!window.ffLiveScores?.fetchWeek) return [];

    // Only games somebody in this league has a pick in. The NFL plays sixteen
    // on a Sunday and most of them decide nothing here; a scoreboard of games
    // nobody named would be thirteen entries of noise in front of the ones that
    // matter.
    const named = new Set();
    const seasonKey = String(window.SEASON || '');
    for (const row of picks || []) {
      if (Number(row?.week) !== week) continue;
      if (seasonKey && String(row.season || seasonKey) !== seasonKey) continue;
      if (String(row.result || '').trim().toUpperCase() === SKIP_RESULT) continue;
      const team = String(row.team || '').trim();
      if (team && team !== NO_PICK_TEAM) named.add(team);
    }

    try {
      const games = await window.ffLiveScores.fetchWeek(season, week);
      // Started, and one of the two sides is under accusation. A fixture that
      // has not kicked off says nothing the pick entries do not already say.
      return (games || []).filter((game) =>
        game.started && (named.has(game.away) || named.has(game.home)));
    } catch (error) {
      console.warn('Wire: no live scoreboard, running without snapshots:', error);
      return [];
    }
  }

  // "LIONS 24 SAINTS 21 3RD 10:33". Leader first, which is how a score is read
  // out loud, then where the game is. No brackets and no "over": the rest of
  // the strip uses those to say a case turned on a result, and a game at half
  // time has not turned anything.
  function snapshotParts(game) {
    const away = Number(game.awayPoints) || 0;
    const home = Number(game.homePoints) || 0;
    const leaderFirst = home > away;

    return {
      first: shortName(leaderFirst ? game.home : game.away),
      second: shortName(leaderFirst ? game.away : game.home),
      firstScore: leaderFirst ? home : away,
      secondScore: leaderFirst ? away : home,
      state: gameState(game)
    };
  }

  // ESPN gives "5:21 - 4th", which reads backwards on a ticker. Built from the
  // period and the clock instead so it comes out "4TH 5:21" - and a finished
  // game just says how it finished, overtime included.
  function gameState(game) {
    if (game.final) return String(game.status || 'Final').trim();

    const period = Number(game.period) || 0;
    const clock = String(game.displayClock || '').trim();
    if (!period) return String(game.status || 'In progress').trim();

    const label = period > 4 ? 'OT' : ['1st', '2nd', '3rd', '4th'][period - 1];
    return clock ? label + ' ' + clock : label;
  }

  function snapshotItemHtml(game) {
    const g = snapshotParts(game);

    return `<span class="wire-item wire-item-score">
      <span class="wire-side">${escapeHtml(g.first)}</span>
      <span class="wire-state-final">${g.firstScore}</span>
      <span class="wire-side">${escapeHtml(g.second)}</span>
      <span class="wire-state-final">${g.secondScore}</span>
      <span class="wire-when">${escapeHtml(g.state)}</span>
    </span>`;
  }

  function snapshotText(game) {
    const g = snapshotParts(game);
    return `${g.first} ${g.firstScore} ${g.second} ${g.secondScore}, ${g.state}.`;
  }

  function render(entries, snapshot = []) {
    const track = document.getElementById('wireTrack');
    const list = document.getElementById('wireList');
    if (!track) return;

    // Reading order, and all of it inside the repeated block so every lap says
    // the same things in the same order: the scoreboard first - it is the news
    // everything else is a consequence of - then the cases that closed, then the picks
    // filed and waiting, then last week's survivors who have not filed again
    // yet. A suspect with neither a pick nor a result gets no entry - there is
    // nothing to report about them.
    const closed = entries.filter((entry) => entry.isOut);
    const rest = entries.filter((entry) => !entry.isOut && entry.pick);

    const items =
      snapshot.map(snapshotItemHtml).join('') +
      closed.map(itemHtml).join('') +
      rest.map(itemHtml).join('') +
      entries.filter((entry) => !entry.isOut && !entry.pick && entry.prior)
        .map(itemHtml).join('');

    // Printed twice. The strip runs from 0 to -50% of the track, so the second
    // copy is what is on screen as the first one leaves and the loop has no
    // seam - in either direction, which is what makes dragging backwards work.
    track.innerHTML = items + items;
    paintMugs(track);
    // The overrides arrive from the database after this first paint, so paint
    // again once they do - the same signal the lineup board listens for.
    window.addEventListener('ff-suspect-colors-loaded', () => paintMugs(track), { once: true });
    runWire(track, Math.max(20, entries.length * SECONDS_PER_ITEM));

    if (list) {
      list.innerHTML =
        snapshot.map((game) => `<li>${escapeHtml(snapshotText(game))}</li>`).join('') +
        closed.map((entry) => `<li>${escapeHtml(lineText(entry))}</li>`).join('') +
        entries.filter((entry) => !entry.isOut && (entry.pick || entry.prior))
          .map((entry) => `<li>${escapeHtml(lineText(entry))}</li>`).join('');
    }
  }

  // Every card on the strip, including the second printed copy of each - they
  // are separate elements and both are on screen at the loop point.
  function paintMugs(track) {
    for (const mug of track.querySelectorAll('.wire-mug')) {
      const img = mug.querySelector('.wire-mug-shot');
      const username = mug.dataset.username || '';

      window.suspectThemeFor?.(img, username).then((pair) => {
        if (!pair) return;
        mug.style.setProperty('--wire-primary', pair[0]);
        mug.style.setProperty('--wire-secondary', pair[1]);
      }).catch(() => {});
    }
  }

  // ===== THE STRIP ITSELF =====

  // Driven from here rather than by a CSS keyframe, because a keyframe cannot be
  // grabbed. Same idea either way - travel half the track, wrap, repeat - but
  // with the offset in a variable, a drag can push it forward or pull it back
  // and the wire picks up from wherever it was let go.
  const wire = {
    started: false,
    track: null,
    seconds: 60,
    offset: 0,
    hovering: false,
    drag: null,
    last: 0
  };

  const MOTION_OK = !window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  function runWire(track, seconds) {
    wire.track = track;
    wire.seconds = seconds;

    if (wire.started) return;
    wire.started = true;

    const strip = track.closest('.wire-strip') || track.parentElement;
    if (strip) {
      strip.addEventListener('pointerenter', () => { wire.hovering = true; });
      strip.addEventListener('pointerleave', () => { wire.hovering = false; });
      strip.addEventListener('pointerdown', (event) => grab(strip, event));
      strip.addEventListener('pointermove', drag);
      strip.addEventListener('pointerup', release);

      // Capture phase, so this runs before the document-level listener in
      // js/mugshot-lightbox.js ever sees the event.
      strip.addEventListener('click', (event) => {
        if (!wire.swallowClick) return;
        wire.swallowClick = false;
        event.preventDefault();
        event.stopPropagation();
      }, true);
      strip.addEventListener('pointercancel', release);
      // A drag that starts on the strip should not also select the text it is
      // dragging, which is what a pointer down on a run of words otherwise does.
      strip.addEventListener('dragstart', (event) => event.preventDefault());
    }

    requestAnimationFrame(step);
  }

  // Half the track: one full copy of the entries. Read fresh each time rather
  // than cached, because it changes when the roster does and once more when the
  // fonts finish loading.
  function wireSpan() {
    return (wire.track?.scrollWidth || 0) / 2;
  }

  function wrapOffset(value) {
    const span = wireSpan();
    if (!span) return 0;
    return ((value % span) + span) % span;
  }

  function paintWire() {
    if (wire.track) wire.track.style.transform = `translateX(${-wire.offset}px)`;
  }

  function step(now) {
    const dt = wire.last ? Math.min(0.25, (now - wire.last) / 1000) : 0;
    wire.last = now;

    // Parked while it is being dragged, while the pointer is resting on it, and
    // for anyone who asked motion to stop - who can still drag it by hand.
    if (MOTION_OK && !wire.drag && !wire.hovering && dt) {
      wire.offset = wrapOffset(wire.offset + (wireSpan() / wire.seconds) * dt);
      paintWire();
    }

    requestAnimationFrame(step);
  }

  function grab(strip, event) {
    if (event.button != null && event.button !== 0) return;
    wire.drag = { id: event.pointerId, x: event.clientX, from: wire.offset, moved: false };
    strip.classList.add('is-dragging');
    if (strip.setPointerCapture) {
      try { strip.setPointerCapture(event.pointerId); } catch (_) { /* not fatal */ }
    }
  }

  // Pull right and the strip rewinds, push left and it runs on. The offset is
  // how far the track has travelled leftwards, so it moves against the pointer.
  function drag(event) {
    if (!wire.drag || event.pointerId !== wire.drag.id) return;
    // Anything past a few pixels is a drag, not a slipped click. Below that a
    // pointer wobbles on the way down and every tap would be swallowed.
    if (Math.abs(event.clientX - wire.drag.x) > 4) wire.drag.moved = true;
    wire.offset = wrapOffset(wire.drag.from - (event.clientX - wire.drag.x));
    paintWire();
  }

  function release(event) {
    if (!wire.drag || event.pointerId !== wire.drag.id) return;
    // Let the click that follows this pointerup know it was the end of a drag.
    // Dragging the strip by a face would otherwise rewind the wire and open
    // that suspect's preview on top of it.
    wire.swallowClick = wire.drag.moved;
    wire.drag = null;
    const strip = event.currentTarget;
    strip.classList.remove('is-dragging');
    if (strip.releasePointerCapture) {
      try { strip.releasePointerCapture(event.pointerId); } catch (_) { /* not fatal */ }
    }
  }

  // The fixtures come out of a generated file that somebody has to rebuild. Say
  // when it was built rather than letting a week-old scoreboard pass for live -
  // a stale file looks exactly like "no games have finished yet".
  function setStamp(text) {
    const el = document.getElementById('wireScoreStamp');
    if (el) el.textContent = text;
  }

  // How current the wire is. The scoring run is the right answer - it is when
  // these sentences last changed - and the scoreboard file's own age is the
  // fallback for a league that has never been scored, or a database without the
  // column yet. Only ever said once there are real entries for it to be about:
  // until then the line carries whatever the strip is carrying, so it is never
  // empty and the page never shifts under it.
  function stampScores(lastScored) {
    if (lastScored) {
      setStamp(stampText(lastScored));
      return;
    }

    const fetched = window.NFL_SCORE_FETCHED_AT ? new Date(window.NFL_SCORE_FETCHED_AT) : null;
    setStamp(fetched && !Number.isNaN(fetched.getTime())
      ? stampText(fetched)
      : 'as of: no fetch on record');
  }

  // "as of friday, september 11th 9:32 am central". The wording is
  // window.ffLongWhen in js/season.js, shared with the admin screen's scoring
  // panel so the two cannot drift.
  function stampText(at) {
    return `as of ${window.ffLongWhen?.(at) || ''}`;
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
