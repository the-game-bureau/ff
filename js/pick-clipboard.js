// ===== PICK CLIPBOARD =====
// The sheet under the scoreboard: current-week picks first, with a week control for
// looking backward or ahead through filed picks.
(function () {
  const PICKBOARD_CONFIG = window.FF_SUPABASE_CONFIG || {};
  const PICKBOARD_SUPABASE_URL = PICKBOARD_CONFIG.url || 'https://vkoczgzizzppdrpvpemh.supabase.co';
  const PICKBOARD_SUPABASE_ANON_KEY = PICKBOARD_CONFIG.publishableKey || 'sb_publishable_XfvD3zCvnCHT1v_EGE-LJA_3Z9bGjKw';
  const ACTIVE_PICKS_VIEW = PICKBOARD_CONFIG.views?.activePicks || 'ff_active_picks';
  const PICKS_TABLE = PICKBOARD_CONFIG.tables?.picks || 'ff_picks';
  const PROFILES_TABLE = PICKBOARD_CONFIG.tables?.profiles || 'ff_profiles';
  const SKIP_RESULT = 'SKIP';
  // The team scoring writes for a suspect who never filed. Not a club, so it is
  // kept off this sheet entirely - see supabase/sql/ff_score_week.sql.
  const NO_PICK_TEAM = 'NO PICK';

  const pickboardDb = window.supabase
    ? window.supabase.createClient(PICKBOARD_SUPABASE_URL, PICKBOARD_SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          // The URL belongs to js/auth-corner.js: one client reads the
          // one-time token a recovery link carries, and several racing for it
          // is why setting a new password did nothing.
          detectSessionInUrl: false,
          storageKey: PICKBOARD_CONFIG.storageKey || 'law-order-svu-auth-vkoczgzizzppdrpvpemh',
          storage: window.localStorage
        }
      })
    : null;

  let activePicks = [];
  // The scoreboard as it stands, from ESPN in the browser. Empty until it
  // answers, and empty forever if it does not - in which case the sheet falls
  // back to the generated file, which is where it was before.
  let liveGames = [];
  // The week the sheet is showing. Seeded from the schedule's guess so the
  // first paint has something, then replaced with the league's own open week in
  // loadPicks() - see the note there before trusting this line.
  let selectedWeek = Number(window.CURRENT_WEEK || 1);
  // Whether that replacement has happened. Set once, so a later reload cannot
  // move a reader who has since paged somewhere else.
  let weekDefaulted = false;
  let pendingFocus = null;
  // username (lower-cased) -> first name. Empty for a signed-out visitor, who
  // is never told anyone's real name.
  let firstNames = new Map();
  // Every booked suspect, in the order the roster gives them. Needed to work
  // out who has NOT filed, which the picks alone can never say.
  let roster = [];
  // user id -> the handle on that profile right now. A pick row carries a
  // snapshot of the name it was filed under, and a suspect can change theirs
  // from their rap sheet, so the snapshot is only a fallback.
  let handles = new Map();

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('pickClipboard')) return;

    bindControls();
    bindTrackerLinks();
    renderWeekOptions();
    renderClipboard();
    loadPicks();
    window.addEventListener('ff-auth-changed', loadPicks);
  });

  // The way back to the board. A name here is the same pick as a cell up there,
  // so clicking one should find the other - the board has linked down to this
  // sheet since it was a table, and the traffic only ran one way.
  function bindTrackerLinks() {
    const body = document.getElementById('pickClipboardBody');
    if (!body || body.dataset.trackerLinksBound === 'true') return;
    body.dataset.trackerLinksBound = 'true';

    const jump = (target) => {
      const username = target?.getAttribute('data-tracker-username');
      if (!username) return;

      // The highlighter goes on the tracker, not here. This end only goes bold,
      // which is enough to show the click landed and to say which name the mark
      // up there belongs to - two marker swipes for one click would read as two
      // separate answers.
      clearHighlight();
      clearActiveName();
      target.classList.add('pick-clipboard-suspect-active');

      window.SuspectTracker?.focusPick?.(username, selectedWeek);
    };

    body.addEventListener('click', (event) => {
      jump(event.target.closest('[data-tracker-username]'));
    });

    body.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const target = event.target.closest('[data-tracker-username]');
      if (!target) return;
      event.preventDefault();
      jump(target);
    });
  }

  function bindControls() {
    const select = document.getElementById('pickClipboardWeek');
    const prev = document.getElementById('prevPickClipboardWeek');
    const next = document.getElementById('nextPickClipboardWeek');

    if (select) {
      select.addEventListener('change', () => {
        selectedWeek = clampWeek(select.value);
        renderClipboard();
      });
    }

    if (prev) {
      prev.addEventListener('click', () => {
        selectedWeek = clampWeek(selectedWeek - 1);
        renderClipboard();
      });
    }

    if (next) {
      next.addEventListener('click', () => {
        selectedWeek = clampWeek(selectedWeek + 1);
        renderClipboard();
      });
    }
  }

  async function loadPicks() {
    // The league's open week, not the schedule's. See js/season.js.
    await window.ffOpenWeekReady;

    // TAKEN AGAIN HERE, ON THE FAR SIDE OF THE AWAIT. The declaration up top
    // runs while the page is still parsing, when CURRENT_WEEK is only the
    // schedule's guess - js/season.js corrects it once the database answers,
    // and the league's week can sit behind the schedule's whenever a game has
    // not been scored yet. The sheet opened on that guess and so could show a
    // different week from everything else on the page.
    //
    // FIRST LOAD ONLY, the same rule the hash follows below: loadPicks() runs
    // again on every auth change, and resetting the week then would drag a
    // reader who had paged back to Week 3 forward to today, mid-read.
    if (!weekDefaulted) {
      weekDefaulted = true;
      selectedWeek = clampWeek(Number(window.CURRENT_WEEK) || 1);
    }

    if (!pickboardDb) {
      setCountText('Clipboard is unavailable.');
      return;
    }

    setCountText('Loading picks...');

    // First names are for the league, not for passers-by - the same rule the
    // lineup room and the tracker run on. Signed out the column is never asked
    // for, so there is nothing to leak: _2026_profiles only grants first_name
    // to the authenticated role, and requesting it anyway would fail the whole
    // read.
    const { data: { user } } = await pickboardDb.auth.getUser();
    const [picks, people] = await Promise.all([
      fetchPicks(),
      fetchRoster(Boolean(user))
    ]);

    if (picks === null) {
      setCountText('Clipboard is unavailable.');
      return;
    }

    roster = people.roster;
    firstNames = people.firstNames;
    handles = people.handles || new Map();
    focusFromHash();
    activePicks = activePicksFromHistory(picks);
    // The weeks cases closed are derived from these, so they have to go stale
    // with them - otherwise a suspect who went out between loads keeps their
    // colour.
    closingWeekCache = null;
    renderWeekOptions();
    renderClipboard();

    // Drawn once without it, then again once the scoreboard answers. The sheet
    // is useful the instant the picks land, and waiting on a third-party fetch
    // to show anything at all would trade that for a tidier sort.
    liveGames = await fetchLiveScores();
    if (liveGames.length) renderClipboard();
  }

  // Which games are over, straight from ESPN. Shared with the Sergeant's Notes
  // through fetchWeekCached, so the Case File asks once rather than twice.
  async function fetchLiveScores() {
    const season = Number(window.SEASON) || 2026;
    const week = Number(window.CURRENT_WEEK) || 1;
    if (!window.ffLiveScores?.fetchWeekCached) return [];

    try {
      return (await window.ffLiveScores.fetchWeekCached(season, week)) || [];
    } catch (error) {
      console.warn('Legal Pad: no live scoreboard, sorting from the file:', error);
      return [];
    }
  }

  async function fetchPicks() {
    let { data, error } = await pickboardDb
      .from(ACTIVE_PICKS_VIEW)
      .select('user_id, username, team, week, result, opponent, home_away, created_at, submitted_at_utc');

    if (error) {
      console.warn('Pick clipboard: active picks view failed, using the table:', error);
      ({ data, error } = await pickboardDb
        .from(PICKS_TABLE)
        .select('*'));
    }

    if (error) {
      console.error('Pick clipboard fetch failed:', error);
      return null;
    }

    return data || [];
  }

  // The roster is read either way - a signed-out visitor still needs to see who
  // has not filed - but first_name is only asked for when signed in. That
  // column is granted to the authenticated role alone, so requesting it as anon
  // fails the whole read and would cost the handles too.
  async function fetchRoster(withFirstNames) {
    const columns = withFirstNames ? 'id, username, first_name' : 'id, username';
    const { data, error } = await pickboardDb
      .from(PROFILES_TABLE)
      .select(columns);

    if (error) {
      // Not fatal: without the roster the pad simply cannot say who is missing,
      // and every other box still reads.
      console.warn('Pick clipboard: roster unavailable:', error);
      return { roster: [], firstNames: new Map() };
    }

    const names = new Map();
    const handleById = new Map();
    const people = [];

    for (const row of data || []) {
      const username = String(row?.username || '').trim();
      if (!username) continue;
      people.push(username);
      if (row?.id) handleById.set(String(row.id), username);

      const first = String(row?.first_name || '').trim();
      if (first) names.set(username.toLowerCase(), first);
    }

    people.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return { roster: people, firstNames: names, handles: handleById };
  }

  function renderWeekOptions() {
    const select = document.getElementById('pickClipboardWeek');
    if (!select) return;

    const max = maxWeek();
    const options = [];
    for (let week = 1; week <= max; week += 1) {
      options.push(`<option value="${week}">Week ${week}</option>`);
    }

    select.innerHTML = options.join('');
    selectedWeek = clampWeek(selectedWeek);
    select.value = String(selectedWeek);
  }

  // One row per team, not per suspect. The Suspect Tracker above already answers
  // "who picked what" - a row per suspect here was the same grid read sideways.
  // Grouped by victim it answers the question the tracker cannot: where the
  // crowd is. Thirteen suspects on the Jets and one lone name out on the
  // Rams is the shape of a survivor week, and neither view showed it.
  function renderClipboard() {
    const titleWeek = document.getElementById('pickClipboardWeekTitle');
    const body = document.getElementById('pickClipboardBody');
    const select = document.getElementById('pickClipboardWeek');
    const prev = document.getElementById('prevPickClipboardWeek');
    const next = document.getElementById('nextPickClipboardWeek');
    if (!body) return;

    selectedWeek = clampWeek(selectedWeek);
    if (titleWeek) titleWeek.textContent = String(selectedWeek);
    if (select) select.value = String(selectedWeek);
    if (prev) prev.disabled = selectedWeek <= 1;
    if (next) next.disabled = selectedWeek >= maxWeek();

    // A "never filed" row is a verdict, not a pick: it carries no team, so it
    // cannot be grouped under one, and counting it would report a week as more
    // filed than it was. The Suspect Tracker shows it; this sheet is about who
    // named whom. See supabase/sql/ff_score_week.sql.
    const weekPicks = activePicks
      .filter((pick) => Number(pick.week) === Number(selectedWeek))
      .filter((pick) => normalizeTeamName(teamName(pick)) !== normalizeTeamName(NO_PICK_TEAM))
      .sort(compareFiledOldestFirst);

    setCountText('');

    // One path for every week, filled or not. A week with no picks used to
    // return early, right past the fitting pass and the focus step below - so
    // the Suspect Tracker could link down to a name in the "no pick yet" box,
    // the box would render, and the click would land on nothing. Which looked
    // exactly like a broken link.
    const missing = unfiledSuspects();

    body.innerHTML = unfiledCardHtml(missing) + groupPicksByTeam(weekPicks).map((group) => {
      // A block can hold both - three live suspects on the Jets and one closed
      // case along for the ride - and the two are listed apart, not counted
      // apart: nothing on the sheet prints a count any more.
      const live = group.picks.filter((pick) => !isExhibition(displayName(pick), selectedWeek));
      const dead = group.picks.filter((pick) => isExhibition(displayName(pick), selectedWeek));

      return `
      <li class="pad-card">
        <span class="pad-card-victim">${victimBlockHtml(group.pick)}</span>

        ${namesBlockHtml(live.map(suspectChipHtml), dead.map(suspectChipHtml))}

        <span class="pad-card-verdict pick-clipboard-verdict">${verdictMark(group.pick)}</span>
      </li>
    `;
    }).join('') + (weekPicks.length || missing.live.length || missing.exhibition.length
      ? ''
      // Only when there is genuinely nothing: no picks and nobody left to make
      // one. Printed alongside a full "no pick yet" box it was saying the same
      // thing twice.
      : `<li class="pick-clipboard-empty">Nothing on file for Week ${selectedWeek}.</li>`);

    fitPadTeams(body);
    fitPadNames(body);

    if (pendingFocus && Number(pendingFocus.week) === Number(selectedWeek)) {
      if (focusPickRow(pendingFocus.username, pendingFocus.week)) {
        pendingFocus = null;
      }
    }
  }

  // Every team name is held to one line, so the long ones have to be brought
  // down to fit rather than allowed to wrap. Stepping the type down beats
  // picking one small size for everybody: "The Jets" keeps the card's full size
  // and only "The Washington Commanders" pays for being long.
  //
  // The same approach fitTeamNames() takes on the lineup placards.
  const PAD_TEAM_MIN_PX = 11;
  const PAD_NAME_MIN_PX = 10;
  // How far below the named team the opponent sits.
  const PAD_OPPONENT_RATIO = 0.86;

  // A record is one line and nothing scrolls, so a long handle with a long first
  // name has nowhere to go but down in size. Same treatment as the team names
  // above it, with a lower floor: these are set smaller to begin with.
  function fitPadNames(root) {
    for (const chip of root.querySelectorAll('.pick-clipboard-suspect')) {
      let size = naturalSize(chip);
      for (; size >= PAD_NAME_MIN_PX; size -= 0.5) {
        chip.style.fontSize = `${size}px`;
        if (chip.scrollWidth <= chip.clientWidth) break;
      }
    }
  }

  function fitPadTeams(root) {
    for (const block of root.querySelectorAll('.pad-card-victim')) {
      const victim = block.querySelector('.pad-team-victim .pick-clipboard-team');
      const opponent = block.querySelector('.pad-team-opponent .pick-clipboard-matchup');
      if (!victim) continue;

      const victimPx = fitOneLine(victim, naturalSize(victim));

      // Measured against the team that was actually named, not against the
      // card. Fitting the two independently inverted them on a long name: "The
      // Washington Commanders" shrank to 13px while its shorter opponent stayed
      // at 14.3px, so the answer read louder than the accusation.
      if (opponent) {
        fitOneLine(opponent, Math.min(naturalSize(opponent), victimPx * PAD_OPPONENT_RATIO));
      }
    }
  }

  function naturalSize(el) {
    el.style.fontSize = '';
    return parseFloat(window.getComputedStyle(el).fontSize) || 20;
  }

  // Steps the type down until the line fits, and reports where it landed.
  function fitOneLine(el, startPx) {
    let size = startPx;
    for (; size >= PAD_TEAM_MIN_PX; size -= 0.5) {
      el.style.fontSize = `${size}px`;
      if (el.scrollWidth <= el.clientWidth) break;
    }
    return Math.max(size, PAD_TEAM_MIN_PX);
  }

  // Biggest crowd first, so the popular pick leads and the lone wolf is last -
  // which is the order you read a survivor week in. Teams level on count fall
  // back to alphabetical so the list does not reshuffle between renders.
  function groupPicksByTeam(picks) {
    const groups = new Map();

    for (const pick of picks) {
      const key = normalizeTeamName(teamName(pick)) || 'unknown';
      const group = groups.get(key) || { pick, picks: [] };
      group.picks.push(pick);
      groups.set(key, group);
    }

    return [...groups.values()].sort((a, b) => {
      // Undecided games first. A sheet of picks is read for the ones still to
      // come; a box whose game finished on Sunday afternoon is a record, and
      // records belong underneath. Within each half the old order stands.
      const byDecided = (isDecided(a.pick) ? 1 : 0) - (isDecided(b.pick) ? 1 : 0);
      if (byDecided) return byDecided;

      if (b.picks.length !== a.picks.length) return b.picks.length - a.picks.length;
      // Level on count, so sort by where the team is from. Comparing the full
      // name gets the same answer for every real NFL name, since they all lead
      // with the place - but only by luck, and a row storing a bare nickname
      // would sort under the wrong letter.
      return cityName(a.pick).localeCompare(cityName(b.pick), undefined, { sensitivity: 'base' });
    });
  }

  // Has this pick's game finished? The generated js/nfl-scores.js first, then the
  // scoreboard this page fetched - the file is only as current as the last
  // deploy, and sorting on it alone would file Sunday's finished games above the
  // ones still to kick off.
  //
  // A game in progress counts as undecided, which is the whole point: it is
  // still worth watching.
  function isDecided(pick) {
    const helpers = window.NFL_SCORE_HELPERS;
    const victimName = teamName(pick);
    const info = window.NFL_SCHEDULE_HELPERS?.getTeamScheduleInfo?.(victimName, Number(pick.week));
    const opponent = info?.opponent;
    if (!opponent) return false;

    const game = helpers?.getGameForTeams?.(victimName, opponent, Number(pick.week));
    if (game?.final) return true;

    return liveGames.some((row) => row.final &&
      (row.away === victimName || row.home === victimName) &&
      (row.away === opponent || row.home === opponent));
  }

  // "New York Jets" -> "New York". Every NFL nickname is a single word, so the
  // place is everything before the last space; a name with no space at all is
  // its own city, which keeps a stored nickname from sorting as an empty string.
  function cityName(pick) {
    const full = String(teamName(pick) || '').trim();
    const cut = full.lastIndexOf(' ');
    return cut === -1 ? full : full.slice(0, cut);
  }

  // The names keep their filing order, so the first one listed is whoever called
  // it first. The stamp moves onto the chip's tooltip rather than into a column
  // of its own: it is the one thing the tracker cannot show, but it does not
  // earn a quarter of the table's width.
  function suspectChipHtml(pick) {
    const username = displayName(pick);
    const exhibition = isExhibition(username, selectedWeek);

    return nameChipHtml(username, {
      id: pickAnchorId(username, selectedWeek),
      title: exhibition
        ? `Case already closed. Filed ${stamp(pick)}, does not count.`
        : `Filed ${stamp(pick)}. Click to find them on the tracker.`,
      linked: true,
      out: exhibition
    });
  }

  // One chip, whether the name filed a pick or is being listed for not filing
  // one. The id is only on the filed ones: the tracker deep-links to those, and
  // an empty cell up there goes to the victims page instead.
  function nameChipHtml(username, options = {}) {
    const first = firstNames.get(String(username).trim().toLowerCase()) || '';
    // Whether this greys is the caller's to say, not this function's. A closed
    // case still owns every pick it filed while it was playing and those keep
    // the weight they earned; what greys is an exhibition pick, filed for a week
    // after the case closed. Only the caller knows which week it is looking at.
    const out = options.out ? ' pick-clipboard-suspect-out' : '';

    return `<span class="pick-clipboard-suspect${out}${options.linked ? ' pick-clipboard-suspect-linked' : ''}"
                  ${options.linked ? `role="button" tabindex="0" data-tracker-username="${escapeHtml(username)}"` : ''}
                  ${options.id ? `id="${escapeHtml(options.id)}"` : ''}
                  ${options.title ? `title="${escapeHtml(options.title)}"` : ''}><span class="pick-clipboard-suspect-handle">${escapeHtml(username)}</span>${
      first ? `<span class="pick-clipboard-suspect-first">(${escapeHtml(first)})</span>` : ''
    }</span>`;
  }

  // handle -> the week their case closed. One pass over the picks, cached for
  // the render: isExhibition() asks this once per chip and the sheet can hold
  // forty of them.
  let closingWeekCache = null;

  // THE WEEK THE CASE CLOSED: the FIRST DUN DUN, not the newest. Out stays out,
  // so a closed suspect who keeps filing and gets one right does not un-close,
  // and it is this week that divides their real season from the exhibition one.
  // Same rule as _2026_is_out and closingWeek() in js/suspect-lineup-chart.js.
  function closingWeeks() {
    if (closingWeekCache) return closingWeekCache;

    closingWeekCache = new Map();
    for (const pick of activePicks) {
      if (!String(pick?.result || '').trim().toLowerCase().includes('dun dun')) continue;

      const name = String(displayName(pick)).trim().toLowerCase();
      const week = Number(pick.week);
      const seen = closingWeekCache.get(name);
      if (seen == null || week < seen) closingWeekCache.set(name, week);
    }

    return closingWeekCache;
  }

  // A pick filed for a week AFTER the one that ended them - judged and shown,
  // never counted, see supabase/sql/ff_exhibition_picks.sql. It is the only
  // thing on this sheet that greys, and the only thing ruled off from the rest.
  //
  // WEEK BY WEEK AND NOT "IS OUT AT ALL", which is what this used to ask.
  // Somebody eliminated in Week 9 had a real Week 3, and greying their name on
  // the Week 3 sheet wiped out most of the board's history - the same fault the
  // Suspect Tracker had until 166fdf3, fixed there and missed here.
  function isExhibition(username, week) {
    const closed = closingWeeks().get(String(username).trim().toLowerCase());
    return closed != null && Number(week) > closed;
  }

  // WHO HAS NOT FILED, split the way every filed box is split. A closed case is
  // not late - nothing is owed once the case is shut - so it cannot go in the
  // same count as a suspect who still has to name somebody. It used to be left
  // off the sheet entirely, which made this the one box where a name simply
  // vanished: a closed case that kept filing was greyed in its team's box, and
  // the same closed case that filed nothing was nowhere at all.
  //
  // Week by week, not "is out at all" - somebody eliminated in Week 9 was live
  // for Week 3 and belongs in blue on that sheet. Same rule as isExhibition().
  function unfiledSuspects() {
    const filed = new Set(
      activePicks
        .filter((pick) => Number(pick.week) === Number(selectedWeek))
        .map((pick) => String(displayName(pick)).trim().toLowerCase())
    );

    const live = [];
    const exhibition = [];

    for (const username of roster) {
      if (filed.has(username.trim().toLowerCase())) continue;
      (isExhibition(username, selectedWeek) ? exhibition : live).push(username);
    }

    return { live, exhibition };
  }

  // The first box, whenever there is one. It is the one thing the sheet cannot
  // show by grouping picks: the picks that are not there - so when there are
  // none missing, there is nothing for it to show and it does not appear.
  // A box reading "no pick yet: everyone has filed" was a heading contradicted
  // by its own contents.
  function unfiledCardHtml(missing) {
    const { live, exhibition } = missing;
    if (!live.length && !exhibition.length) return '';

    // Addressable, because the tracker's blank cells link here now rather than
    // to the victims page. A suspect is filed or unfiled for a week, never
    // both, so one id scheme covers both boxes without collision.
    const chip = (username, out) => nameChipHtml(username, {
      id: pickAnchorId(username, selectedWeek),
      title: out
        ? 'Case already closed. Nothing owed, nothing counted.'
        : 'Click to find them on the tracker.',
      linked: true,
      out
    });

    return `
      <li class="pad-card pad-card-unfiled">
        <span class="pad-card-head">no pick yet</span>

        ${namesBlockHtml(
          live.map((username) => chip(username, false)),
          exhibition.map((username) => chip(username, true))
        )}
      </li>`;
  }

  // THE NAMES IN TWO BLOCKS, BLUE THEN GREY, RULED APART. Filing order holds
  // inside each block, so the first name in the blue run is still whoever
  // called it first. One run in pure filing order scattered the closed cases
  // through the live ones, which made grey read as a colour some names happen
  // to be rather than as the separate thing it is. Now that no count is printed
  // anywhere on the sheet, the rule is the only thing saying so.
  function namesBlockHtml(live, dead) {
    if (!dead.length) {
      return `<span class="pick-clipboard-suspect-names">${live.join('')}</span>`;
    }

    // The rule is only drawn when there is something on both sides of it: a
    // line under the last name, or above the first, separates nothing. The
    // sentence carries what the rule and the grey say to anyone who can see
    // them, since nothing else on the card states it any more.
    const split = (live.length
      ? '<span class="pad-card-names-split" aria-hidden="true"></span>'
      : '')
      + `<span class="sr-only">Plus ${dead.length} from closed cases, which do not count:</span>`;

    return `<span class="pick-clipboard-suspect-names">${live.join('')}${split}${dead.join('')}</span>`;
  }

  function maxWeek() {
    const scheduleWeeks = Array.isArray(window.NFL_SCHEDULE_GAMES)
      ? window.NFL_SCHEDULE_GAMES.map((game) => Number(game.week || 0))
      : [];
    const pickWeeks = activePicks.map((pick) => Number(pick.week || 0));
    return Math.max(18, Number(window.CURRENT_WEEK || 1), ...scheduleWeeks, ...pickWeeks);
  }

  function clampWeek(value) {
    const week = Number(value);
    if (!Number.isFinite(week)) return 1;
    return Math.min(Math.max(1, Math.round(week)), maxWeek());
  }

  function activePicksFromHistory(picks) {
    const latestByUserWeek = new Map();

    for (const pick of (picks || []).filter(isCurrentSeasonPick)) {
      const week = Number(pick.week);
      if (!week || !pick.team) continue;

      const key = `${pick.user_id || pick.username || 'unknown'}:${week}`;
      const previous = latestByUserWeek.get(key);
      if (!previous || pickTime(pick) > pickTime(previous)) {
        latestByUserWeek.set(key, pick);
      }
    }

    return [...latestByUserWeek.values()].filter((pick) => !isSkippedPick(pick));
  }

  function isCurrentSeasonPick(pick) {
    return !pick.season || Number(pick.season) === Number(window.SEASON || pick.season);
  }

  function isSkippedPick(pick) {
    return String(pick?.result || '').trim().toUpperCase() === SKIP_RESULT;
  }

  function pickTime(pick) {
    return pickDate(pick)?.getTime() || 0;
  }

  function compareFiledOldestFirst(a, b) {
    const aTime = pickTime(a) || Number.MAX_SAFE_INTEGER;
    const bTime = pickTime(b) || Number.MAX_SAFE_INTEGER;
    return aTime - bTime ||
      displayName(a).localeCompare(displayName(b)) ||
      teamName(a).localeCompare(teamName(b));
  }

  // The name on the profile now, not the one stamped on the pick when it was
  // filed. Without this a rename would split somebody's season across two
  // names on this pad and break the jump to the Suspect Tracker, which keys off
  // the profile. The snapshot is the fallback for a pick whose owner has since
  // left the roster.
  function displayName(pick) {
    const current = handles.get(String(pick?.user_id || ''));
    return String(current || pick?.username || '(unknown)').trim() || '(unknown)';
  }

  function teamName(pick) {
    return String(pick?.team || '').trim();
  }







  function victimLogoHtml(pick) {
    const team = teamForName(teamName(pick));
    if (!team) return '';

    return teamLogoHtml(team);
  }

  function teamLogoHtml(team) {
    return `<img class="pick-clipboard-team-logo"
                 src="${escapeHtml(teamLogoSrc(team.abbr))}"
                 alt=""
                 loading="lazy"
                 decoding="async"/>`;
  }

  function teamForName(name) {
    const key = normalizeTeamName(name);
    if (!key) return null;

    return availableTeams().find((team) => normalizeTeamName(team.name) === key) || null;
  }

  function availableTeams() {
    return typeof NFL_TEAMS === 'undefined' ? [] : NFL_TEAMS;
  }

  function teamLogoSrc(abbr) {
    return `https://static.www.nfl.com/league/api/clubs/logos/${encodeURIComponent(String(abbr || '').trim())}.svg`;
  }

  function normalizeTeamName(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  // Legal-pad verdicts are the truth value of the accusation: the named victim
  // did lose, or the pick lied. A pick with no result yet is left blank.
  //
  // Read from the result on the pick, which is where it comes from. There was a
  // second path here that derived the verdict from live scores, but both score
  // sources are empty arrays - it drew a placeholder 00 on every line and never
  // once reached a verdict.
  function verdictMark(pick) {
    const result = String(pick?.result || '').trim().toLowerCase();

    if (result.includes('survived')) {
      return '<span class="pick-clipboard-verdict-word pick-clipboard-verdict-truth">TRUTH</span>';
    }

    if (result.includes('dun dun')) {
      return '<span class="pick-clipboard-verdict-word pick-clipboard-verdict-lie">LIE</span>';
    }

    return '<span class="sr-only">Pending</span>';
  }



  // The accusation, on three lines: who is named, what is being said about them,
  // and who they have to lose to. Reads as a sentence down the box rather than
  // as a row of fields across it.
  function victimBlockHtml(pick) {
    const matchup = matchupDetails(pick);
    const score = finalScore(pick, matchup);

    const victim = `
      <span class="pad-team pad-team-victim">
        ${victimLogoHtml(pick)}
        <span class="pick-clipboard-team">The ${escapeHtml(teamName(pick))}</span>
      </span>`;

    if (matchup.isBye) {
      return `${victim}<span class="pad-team-verb">on a bye</span>`;
    }

    const opponent = teamForName(matchup.opponent);
    return `
      ${victim}
      <span class="pad-team-verb">to lose ${escapeHtml(loseVerb(matchup.homeAway))}</span>
      <span class="pad-team pad-team-opponent">
        ${opponent ? teamLogoHtml(opponent) : ''}
        <span class="pick-clipboard-matchup">The ${escapeHtml(matchup.opponent || matchup.shortName)}</span>
      </span>
      ${scoreHtml(score)}`;
  }

  // The final, written in beside each team. The pad had no scores because the
  // machinery behind them was an empty array - js/nfl-scores.js is generated
  // now, so a sheet that says who lost can say by how much.
  //
  // Only a finished game gets one. A number next to a team that has not played
  // would read as a prediction.
  function finalScore(pick, matchup) {
    if (matchup.isBye) return null;

    const helpers = window.NFL_SCORE_HELPERS;
    const victimName = teamName(pick);
    const game = helpers?.getGameForTeams?.(victimName, matchup.opponent, Number(pick.week));

    if (game?.final) {
      const victim = helpers.getTeamScoreFromGame?.(game, victimName);
      const opponent = helpers.getTeamScoreFromGame?.(game, matchup.opponent);
      if (Number.isInteger(victim) && Number.isInteger(opponent)) return { victim, opponent };
    }

    // Not in the generated file, which is only as current as the last deploy.
    // The sort above already treats this game as played, from the same live
    // scoreboard - a box filed under "already happened" with no score in it
    // reads as a bug.
    const live = liveGames.find((row) => row.final &&
      (row.away === victimName || row.home === victimName) &&
      (row.away === matchup.opponent || row.home === matchup.opponent));
    if (!live) return null;

    const victim = Number(live.away === victimName ? live.awayPoints : live.homePoints);
    const opponent = Number(live.away === victimName ? live.homePoints : live.awayPoints);
    if (!Number.isFinite(victim) || !Number.isFinite(opponent)) return null;

    return { victim, opponent };
  }

  // On its own line under the fixture, not tucked in beside each team name.
  // Beside them it had to share a flex row with the name, and the fitting pass
  // that holds a team to one line would run out of room before it ran out of
  // name: "The Seattle Seahawks" came out as "The Seattle Seaha". A score is
  // two numbers; it does not need to be threaded through the words.
  //
  // The order matches the two lines above it - the named team first, then who
  // they had to lose to - so it reads down the box without a label.
  function scoreHtml(score) {
    if (!score) return '';
    return `
      <span class="pad-final">
        <span class="pad-final-score">${score.victim}</span>
        <span class="pad-final-dash" aria-hidden="true">-</span>
        <span class="pad-final-score">${score.opponent}</span>
      </span>`;
  }

  // The schedule stores the two sides as "@" and "vs". "@" already reads as a
  // sentence - "to lose @ the Titans" - but "vs" does not, so a home game is
  // spelled out instead.
  function loseVerb(homeAway) {
    return String(homeAway || '').trim() === 'vs' ? 'at home to' : '@';
  }


  function matchupDetails(pick) {
    const storedOpponent = String(pick?.opponent || '').trim();
    const storedHomeAway = String(pick?.home_away || '').trim();
    if (storedOpponent) {
      return {
        homeAway: storedHomeAway || 'vs',
        opponent: storedOpponent,
        shortName: shortTeamName(storedOpponent),
        isBye: false
      };
    }

    const info = window.NFL_SCHEDULE_HELPERS?.getTeamScheduleInfo?.(teamName(pick), Number(pick.week));
    if (!info || info.isBye) return { isBye: true };
    return {
      homeAway: info.homeAway,
      opponent: info.opponent || '',
      shortName: info.opponentShort || shortTeamName(info.opponent),
      isBye: false
    };
  }

  function shortTeamName(name) {
    const parts = String(name || '').trim().split(/\s+/);
    return parts[parts.length - 1] || '';
  }

  function stamp(pick) {
    const date = pickDate(pick);
    if (!date) return '-';

    return date.toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    });
  }

  function pickDate(pick) {
    const when = pick?.submitted_at_utc || pick?.created_at;
    if (!when) return null;

    const date = new Date(normalizeUtcTimestamp(when));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function normalizeUtcTimestamp(value) {
    const text = String(value || '').trim();
    if (!text) return '';

    // submitted_at_utc is stored as UTC. If a backend response omits the
    // timezone suffix, make that UTC explicit before converting to Central.
    return /(?:z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`;
  }

  function pickAnchorId(username, week) {
    return `pick-clipboard-w${Number(week)}-${anchorSlug(username)}`;
  }

  function anchorSlug(value) {
    return String(value || 'unknown')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'unknown';
  }

  // A cell on the Suspect Tracker links here by anchor, and until now nothing
  // read that on arrival: the href worked only because a click handler
  // intercepted it, so opening one in a new tab - or pasting the link to
  // somebody - landed on the current week with nothing marked. Honouring the
  // address makes every pick on the board a link worth sending.
  //
  // Once only. loadPicks() runs again on every auth change, and re-applying the
  // hash then would drag the reader back to a week they had since left.
  let hashHonoured = false;

  function focusFromHash() {
    if (hashHonoured) return;
    hashHonoured = true;

    const match = /^#pick-clipboard-w(\d+)-(.+)$/.exec(window.location.hash || '');
    if (!match) return;

    // The slug is lossy - lower-cased, punctuation folded - so it is matched by
    // re-slugging each known handle rather than reversed.
    const wanted = match[2];
    const username = roster.find((name) => anchorSlug(name) === wanted);
    if (!username) return;

    selectedWeek = clampWeek(Number(match[1]));
    pendingFocus = { username, week: selectedWeek };
  }

  function focusPickRow(username, week) {
    // The tracker links per suspect, so the anchor is that suspect's name inside
    // their team's box. Scroll to it and run the highlighter over it.
    const row = document.getElementById(pickAnchorId(username, week));
    if (!row) return false;

    clearHighlight();
    clearActiveName();

    row.focus({ preventScroll: true });
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Reading a layout property between removing and adding the class restarts
    // the swipe. Without it, clicking the same name twice does nothing visible:
    // the browser collapses the two changes into no change at all.
    void row.offsetWidth;
    row.classList.add('pick-clipboard-row-target');
    return true;
  }

  // One mark at a time. It stays put until another name is clicked or the page
  // is reloaded - it used to wipe itself after 1.6 seconds, which meant looking
  // away for a moment lost the answer you had just asked for.
  function clearHighlight() {
    for (const el of document.querySelectorAll('.pick-clipboard-row-target')) {
      el.classList.remove('pick-clipboard-row-target');
    }
  }

  // One name bold at a time, the same way one name is marked at a time.
  function clearActiveName() {
    for (const el of document.querySelectorAll('.pick-clipboard-suspect-active')) {
      el.classList.remove('pick-clipboard-suspect-active');
    }
  }

  window.PickClipboard = Object.freeze({
    anchorIdFor: pickAnchorId,
    showWeek(week, username) {
      selectedWeek = clampWeek(week);
      pendingFocus = username ? { username, week: selectedWeek } : null;
      renderWeekOptions();
      renderClipboard();
    }
  });

  // The one line beside the heading, and it only ever says the sheet is coming
  // or why it is not. Emptied on a good render, and the stylesheet hides it
  // empty, so a loaded pad carries no status at all.
  function setCountText(message) {
    const el = document.getElementById('pickClipboardCount');
    if (!el) return;

    el.textContent = message;
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
