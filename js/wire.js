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
  const PICKS_TABLE = WIRE_CONFIG.tables?.picks || 'ff_picks';

  // Seconds of travel per entry. Fixed per entry rather than per strip, so a
  // forty-suspect wire reads at the same speed as a four-suspect one.
  const SECONDS_PER_ITEM = 9;

  // Roughly what an entry travels at, used for the standalone phrases - Loading,
  // Radio is down - where there is no entry count to scale by.
  const MESSAGE_PIXELS_PER_SECOND = 120;

  // The scorer's row for a week nobody filed. It is a verdict, not a pick, and
  // must never be read out as one.
  const NO_PICK_TEAM = 'NO PICK';
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
    if (!wireDb) {
      runMessage('Radio is down.');
      return;
    }

    runMessage('Wire loading...');

    const [suspects, picks] = await Promise.all([fetchSuspects(), fetchPicks()]);
    if (suspects === null || picks === null) {
      runMessage('Radio is down.');
      return;
    }

    const entries = buildEntries(suspects, picks);
    if (!entries.length) {
      runMessage('Nobody on the board yet.');
      return;
    }

    render(entries);
    stampScores(await fetchLastScored());
  }

  // When SCORE THE WEEK was last run, which is when the sentences on this strip
  // last changed. Its own query, and a forgiving one: the column arrives with
  // supabase/sql/ff_scored_at.sql, and asking for a column that is not there
  // yet fails the whole request. So it is asked for separately and a failure
  // just means the wire dates itself from the scoreboard file instead.
  async function fetchLastScored() {
    // The table, not the view. _2026_active_picks is defined with SELECT *,
    // which Postgres expands once when the view is created - a column added to
    // the table afterwards never appears in it. The table has the column and
    // the grant, and the newest stamp is the newest stamp either way.
    const { data, error } = await wireDb
      .from(PICKS_TABLE)
      .select('scored_at')
      .not('scored_at', 'is', null)
      .order('scored_at', { ascending: false })
      .limit(1);

    if (error) {
      console.warn('No scored_at on file; dating the wire from the scoreboard instead:', error);
      return null;
    }

    const at = data?.[0]?.scored_at ? new Date(data[0].scored_at) : null;
    return at && !Number.isNaN(at.getTime()) ? at : null;
  }

  // One phrase, repeated enough times to fill the strip and go on filling it as
  // it travels. Sized off the viewport rather than a fixed count, because half
  // the track has to be at least a screen wide or the loop shows its seam.
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

  async function fetchSuspects() {
    const { data, error } = await wireDb
      .from(SUSPECTS_VIEW)
      .select('id, username, avatar_data_url, game_status');

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
          username: String(suspect.username || 'unknown'),
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
    const score = window.NFL_SCORE_HELPERS?.getGameForTeams?.(away, home, week) || null;

    return {
      away,
      home,
      score,
      kickoff: kickoffParts(game?.kickoffUtc),
      isTbd: Boolean(info.isTbd)
    };
  }

  // Day and time apart, because the line says them apart: "on Sun at 3:25 PM".
  // Central, the same zone js/nfl-schedule.js formats every other kickoff in, so
  // a time read here matches the one read on the victims page.
  function kickoffParts(kickoffUtc) {
    if (!kickoffUtc) return null;

    const at = new Date(kickoffUtc);
    if (Number.isNaN(at.getTime())) return null;

    const zone = { timeZone: 'America/Chicago' };
    return {
      day: new Intl.DateTimeFormat('en-US', { ...zone, weekday: 'short' }).format(at),
      time: new Intl.DateTimeFormat('en-US', { ...zone, hour: 'numeric', minute: '2-digit' }).format(at)
    };
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
  function survivalHtml(entry) {
    const prior = entry.prior;
    if (!prior) return STOP;

    const victim = prior.pick.team;
    const f = prior.fixture;
    const score = f?.score?.final ? f.score : null;

    // Marked as having survived with no final on file for the game: the
    // scoreboard is behind. Say only what is known.
    if (!f || !score) {
      return `<span class="wire-because">because they survived Week ${prior.week}</span>${STOP}`;
    }

    const opponent = f.away === victim ? f.home : f.away;
    const victimScore = Number(f.away === victim ? score.awayScore : score.homeScore);
    const opponentScore = Number(f.away === victim ? score.homeScore : score.awayScore);

    return `<span class="wire-because">because their pick, the</span>
      <strong>${escapeHtml(shortName(victim))}</strong>${COMMA}
      <span class="wire-because">scored only</span>
      <span class="wire-state-final">${victimScore}</span>
      <span class="wire-because">points and</span>
      <span class="wire-verdict-good">did in fact lose</span>
      <span class="wire-because">to the</span>
      <span class="wire-side">${escapeHtml(shortName(opponent))}</span>
      <span class="wire-because">who scored</span>
      <span class="wire-state-final">${opponentScore}</span>${STOP}`;
  }

  // The second sentence: the week in front of them. Filed, it names the accused,
  // who they have to lose to, and when the game is - the whole fixture said as a
  // sentence, which is what replaced the boxed-off scoreboard line that used to
  // sit at the end of every entry saying the same thing twice.
  function nextPickHtml(entry) {
    if (!entry.pick) {
      return `<span class="wire-because">They have</span>
        <span class="wire-pick-none">not named a victim</span>
        <span class="wire-because">for Week ${entry.week} yet</span>`;
    }

    const f = entry.fixture;
    const victim = entry.pick.team;
    const opponent = f ? (f.away === victim ? f.home : f.away) : '';

    let head = `<span class="wire-because">They picked the</span>
      <strong>${escapeHtml(victim)}</strong>
      <span class="wire-because">to lose</span>`;

    if (opponent) {
      head += ` <span class="wire-because">to the</span>
        <span class="wire-side">${escapeHtml(opponent)}</span>`;
    }

    head += ` <span class="wire-because">in Week ${entry.week}</span>${STOP}`;

    // Its own sentence, because it is the only unsettled thing on the line: the
    // accusation is filed and everything after this is the game being played.
    // A flex-scheduled week arrives with no announced time, so there is a
    // version of it with nothing to point at yet.
    if (f?.kickoff) {
      head += ` <span class="wire-pending">We'll see</span>
        <span class="wire-because">on</span>
        <span class="wire-when">${escapeHtml(f.kickoff.day)}</span>
        <span class="wire-because">at</span>
        <span class="wire-when">${escapeHtml(f.kickoff.time)}</span>`;
    } else if (f) {
      head += ` <span class="wire-pending">We'll see</span>
        <span class="wire-because">once the time is announced</span>`;
    }

    // Only ever reached out of order: a survived week rolls the suspect on to
    // the next one and a DUN DUN closes the case, so an open week carrying a
    // result at all means something upstream is out of step. Say so rather than
    // reporting a decided game as pending.
    const result = String(entry.pick.result || '').trim().toUpperCase();
    if (result.includes('SURVIVED')) {
      head += '<span class="wire-verdict wire-verdict-good">Survived</span>';
    } else if (result.includes('DUN DUN')) {
      head += '<span class="wire-verdict wire-verdict-bad">Dun Dun</span>';
    }

    return head;
  }

  // Punctuation, which is not a word - see .wire-stop for why it needs
  // saying. Both close up against whatever they follow.
  const STOP = '<span class="wire-stop">.</span>';
  const COMMA = '<span class="wire-stop">,</span>';

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
  function mugHtml(entry) {
    const shot = entry.avatar
      ? `<img class="wire-mug-shot" src="${escapeHtml(entry.avatar)}" alt="" width="30" height="30"/>`
      : '';

    return `<span class="wire-mug" data-username="${escapeHtml(entry.username)}">
      <span class="wire-mug-frame">${shot}</span>
      <span class="wire-name">${escapeHtml(entry.username)}</span>
    </span>`;
  }

  function closedHtml(entry) {
    const head = `${mugHtml(entry)}
      <span class="wire-is">is</span>
      <span class="wire-gone">no longer a suspect</span>
      <span class="wire-because">as of Week ${entry.week} because</span>`;

    if (entry.neverFiled || !entry.pick) {
      return `${head} <span class="wire-pick-none">no victim was ever named</span>`;
    }

    const victim = entry.pick.team;
    const f = entry.fixture;
    const score = f?.score?.final ? f.score : null;

    if (!f || !score) {
      // No final on file for the game that ended them - the scoreboard file is
      // behind. Say what is known instead of inventing a result.
      return `${head} <span class="wire-because">their pick, the</span>
        <strong>${escapeHtml(shortName(victim))}</strong>${COMMA}
        <span class="wire-verdict-bad">did not lose</span>`;
    }

    const opponent = f.away === victim ? f.home : f.away;
    const victimScore = Number(f.away === victim ? score.awayScore : score.homeScore);
    const opponentScore = Number(f.away === victim ? score.homeScore : score.awayScore);

    return `${head} <span class="wire-because">their pick, the</span>
      <strong>${escapeHtml(shortName(victim))}</strong>${COMMA}
      <span class="wire-because">scored</span>
      <span class="wire-state-final">${victimScore}</span>
      <span class="wire-because">points and</span>
      <span class="wire-verdict-bad">did not lose</span>
      <span class="wire-because">to the</span>
      <span class="wire-side">${escapeHtml(shortName(opponent))}</span>
      <span class="wire-because">who ${victimScore === opponentScore ? 'also' : 'only'} scored</span>
      <span class="wire-state-final">${opponentScore}</span>`;
  }

  function itemHtml(entry) {
    const body = entry.isOut
      ? closedHtml(entry)
      : `${mugHtml(entry)}
         <span class="wire-is">is</span>
         ${statusHtml(entry)}
         ${survivalHtml(entry)}
         ${nextPickHtml(entry)}`;

    return `
      <span class="wire-item${entry.isOut ? ' wire-item-out' : ''}">${body}${STOP}</span>
      <span class="wire-sep" aria-hidden="true">///</span>`;
  }

  // The same entry as a sentence, for the static list under the strip. A
  // marquee is a miserable thing to read with a screen reader, so the strip is
  // aria-hidden and this is what is actually announced.
  function lineText(entry) {
    if (entry.isOut) return closedText(entry);

    const head = `${entry.username} is Still A Suspect${priorText(entry)}`;
    if (!entry.pick) {
      return `${head} They have not named a victim for Week ${entry.week} yet.`;
    }

    const f = entry.fixture;
    const victim = entry.pick.team;
    const opponent = f ? (f.away === victim ? f.home : f.away) : '';

    let line = `${head} They picked the ${victim} to lose`;
    if (opponent) line += ` to the ${opponent}`;
    line += ` in Week ${entry.week}.`;
    if (f?.kickoff) line += ` We'll see on ${f.kickoff.day} at ${f.kickoff.time}.`;
    else if (f) line += " We'll see once the time is announced.";

    const result = String(entry.pick.result || '').trim().toUpperCase();
    if (result.includes('SURVIVED')) return `${line} Survived.`;
    if (result.includes('DUN DUN')) return `${line} Dun dun.`;
    return line;
  }

  function priorText(entry) {
    const prior = entry.prior;
    if (!prior) return '.';

    const victim = prior.pick.team;
    const f = prior.fixture;
    const score = f?.score?.final ? f.score : null;
    if (!f || !score) return ` because they survived Week ${prior.week}.`;

    const opponent = f.away === victim ? f.home : f.away;
    const victimScore = Number(f.away === victim ? score.awayScore : score.homeScore);
    const opponentScore = Number(f.away === victim ? score.homeScore : score.awayScore);

    return ` because their pick, the ${shortName(victim)}, scored only ${victimScore} points ` +
      `and did in fact lose to the ${shortName(opponent)} who scored ${opponentScore}.`;
  }

  function closedText(entry) {
    const head = `${entry.username} is no longer a suspect as of Week ${entry.week} because`;

    if (entry.neverFiled || !entry.pick) return `${head} no victim was ever named.`;

    const victim = entry.pick.team;
    const f = entry.fixture;
    const score = f?.score?.final ? f.score : null;
    if (!f || !score) return `${head} their pick, the ${shortName(victim)}, did not lose.`;

    const opponent = f.away === victim ? f.home : f.away;
    const victimScore = Number(f.away === victim ? score.awayScore : score.homeScore);
    const opponentScore = Number(f.away === victim ? score.homeScore : score.awayScore);

    return `${head} their pick, the ${shortName(victim)}, scored ${victimScore} points and ` +
      `did not lose to the ${shortName(opponent)} who ` +
      `${victimScore === opponentScore ? 'also' : 'only'} scored ${opponentScore}.`;
  }

  function render(entries) {
    const track = document.getElementById('wireTrack');
    const list = document.getElementById('wireList');
    if (!track) return;

    const items = entries.map(itemHtml).join('');

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
      list.innerHTML = entries.map((entry) => `<li>${escapeHtml(lineText(entry))}</li>`).join('');
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
    wire.drag = { id: event.pointerId, x: event.clientX, from: wire.offset };
    strip.classList.add('is-dragging');
    if (strip.setPointerCapture) {
      try { strip.setPointerCapture(event.pointerId); } catch (_) { /* not fatal */ }
    }
  }

  // Pull right and the strip rewinds, push left and it runs on. The offset is
  // how far the track has travelled leftwards, so it moves against the pointer.
  function drag(event) {
    if (!wire.drag || event.pointerId !== wire.drag.id) return;
    wire.offset = wrapOffset(wire.drag.from - (event.clientX - wire.drag.x));
    paintWire();
  }

  function release(event) {
    if (!wire.drag || event.pointerId !== wire.drag.id) return;
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

  // "as of friday, september 11th 9:32 am central". Central because that is the
  // zone every other time on this site is given in - the kickoffs on the wire
  // above it included - and a scoreboard timestamp quietly rendered in the
  // reader's own zone would disagree with them by an hour or three.
  function stampText(at) {
    const zone = { timeZone: 'America/Chicago' };
    const part = (options) => new Intl.DateTimeFormat('en-US', { ...zone, ...options }).format(at);

    const day = Number(part({ day: 'numeric' }));
    const time = part({ hour: 'numeric', minute: '2-digit' }).toLowerCase();

    return `as of ${part({ weekday: 'long' })}, ${part({ month: 'long' })} ` +
      `${day}${ordinal(day)} ${time} central`;
  }

  // 1st, 2nd, 3rd, 4th - and 11th, 12th, 13th, which break the pattern and are
  // the whole reason this is not a lookup on the last digit alone.
  function ordinal(day) {
    const teens = day % 100;
    if (teens >= 11 && teens <= 13) return 'th';
    return ['th', 'st', 'nd', 'rd'][day % 10] || 'th';
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
