// ===== PICK CLIPBOARD =====
// The sheet under the docket: current-week picks first, with a week control for
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
  let selectedWeek = Number(window.CURRENT_WEEK || 1);
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
    renderWeekOptions();
    renderClipboard();
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

    renderPickTally(weekPicks.length);

    // One path for every week, filled or not. A week with no picks used to
    // return early, right past the fitting pass and the focus step below - so
    // the Suspect Tracker could link down to a name in the "no pick yet" box,
    // the box would render, and the click would land on nothing. Which looked
    // exactly like a broken link.
    const missing = unfiledSuspects();

    body.innerHTML = unfiledCardHtml(missing) + groupPicksByTeam(weekPicks).map((group) => `
      <li class="pad-card">
        <span class="pad-card-head">
          <span class="pad-card-tally">${tallyHtml(group.picks.length)}</span>
          <span class="pick-clipboard-suspect-word">${escapeHtml(suspectLabel(group.picks.length))}</span>
          <span class="sr-only">${group.picks.length}</span>
        </span>

        <span class="pad-card-victim">${victimBlockHtml(group.pick)}</span>

        <span class="pick-clipboard-suspect-names">${group.picks.map(suspectChipHtml).join('')}</span>

        <span class="pad-card-verdict pick-clipboard-verdict">${verdictMark(group.pick)}</span>
      </li>
    `).join('') + (weekPicks.length || missing.length
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
      if (b.picks.length !== a.picks.length) return b.picks.length - a.picks.length;
      // Level on count, so sort by where the team is from. Comparing the full
      // name gets the same answer for every real NFL name, since they all lead
      // with the place - but only by luck, and a row storing a bare nickname
      // would sort under the wrong letter.
      return cityName(a.pick).localeCompare(cityName(b.pick), undefined, { sensitivity: 'base' });
    });
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
    return nameChipHtml(username, {
      id: pickAnchorId(username, selectedWeek),
      title: `Filed ${stamp(pick)}. Click to find them on the tracker.`,
      linked: true
    });
  }

  // One chip, whether the name filed a pick or is being listed for not filing
  // one. The id is only on the filed ones: the tracker deep-links to those, and
  // an empty cell up there goes to the victims page instead.
  function nameChipHtml(username, options = {}) {
    const first = firstNames.get(String(username).trim().toLowerCase()) || '';

    return `<span class="pick-clipboard-suspect${options.linked ? ' pick-clipboard-suspect-linked' : ''}"
                  ${options.linked ? `role="button" tabindex="0" data-tracker-username="${escapeHtml(username)}"` : ''}
                  ${options.id ? `id="${escapeHtml(options.id)}"` : ''}
                  ${options.title ? `title="${escapeHtml(options.title)}"` : ''}><span class="pick-clipboard-suspect-handle">${escapeHtml(username)}</span>${
      first ? `<span class="pick-clipboard-suspect-first">(${escapeHtml(first)})</span>` : ''
    }</span>`;
  }

  // Everyone still in the game who has not filed for the week being viewed.
  //
  // Eliminated suspects are left out: their season is over, so listing them as
  // "no pick yet" would be reporting a pick that is never coming as if it were
  // late. Same rule the tracker's tally and the APB both follow.
  function unfiledSuspects() {
    const filed = new Set(
      activePicks
        .filter((pick) => Number(pick.week) === Number(selectedWeek))
        .map((pick) => String(displayName(pick)).trim().toLowerCase())
    );

    const out = new Set(
      activePicks
        .filter((pick) => String(pick?.result || '').trim().toLowerCase().includes('dun dun'))
        .map((pick) => String(displayName(pick)).trim().toLowerCase())
    );

    return roster.filter((username) => {
      const key = username.trim().toLowerCase();
      return !filed.has(key) && !out.has(key);
    });
  }

  // The first box, always. It is the one thing the sheet cannot show by
  // grouping picks: the picks that are not there.
  function unfiledCardHtml(missing) {
    return `
      <li class="pad-card pad-card-unfiled">
        <span class="pad-card-head">
          <span class="pad-card-tally">${tallyHtml(missing.length)}</span>
          <span class="pick-clipboard-suspect-word">no pick yet</span>
          <span class="sr-only">${missing.length}</span>
        </span>

        <span class="pick-clipboard-suspect-names">${
          missing.length
            ? missing.map((username) => nameChipHtml(username, {
                // Addressable, because the tracker's blank cells link here now
                // rather than to the victims page. A suspect is filed or
                // unfiled for a week, never both, so one id scheme covers both
                // boxes without collision.
                id: pickAnchorId(username, selectedWeek),
                title: 'Click to find them on the tracker.',
                linked: true
              })).join('')
            : '<span class="pad-card-allin">everyone has filed</span>'
        }</span>
      </li>`;
  }

  // Trails off into the team named below it: "7 suspects pick... New York Jets".
  function suspectLabel(count) {
    return count === 1 ? 'suspect picks...' : 'suspects pick...';
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

  function countLabel(count) {
    if (!count) return `No Week ${selectedWeek} picks on file.`;
    return `${count} Week ${selectedWeek} ${count === 1 ? 'pick' : 'picks'} on file.`;
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

  function renderPickTally(count) {
    const el = document.getElementById('pickClipboardCount');
    if (!el) return;

    el.classList.remove('pick-clipboard-count-text');
    el.classList.add('pick-clipboard-count-tally');
    el.innerHTML = `<span class="sr-only">${escapeHtml(countLabel(count))}</span>${tallyHtml(count)}`;
  }

  function tallyHtml(count) {
    const total = Math.max(0, Number(count) || 0);
    if (!total) return '<span class="pick-tally pick-tally-empty" aria-hidden="true"></span>';

    const groups = [];
    for (let remaining = total; remaining > 0; remaining -= 5) {
      groups.push(tallyGroupHtml(Math.min(5, remaining)));
    }

    return `<span class="pick-tally" aria-hidden="true">${groups.join('')}</span>`;
  }

  function tallyGroupHtml(count) {
    const marks = [
      '<path d="M7 6 C5.8 16 7.7 27 6.8 39" />',
      '<path d="M17 5 C15.8 17 17.6 29 16.8 40" />',
      '<path d="M27 6 C25.8 16 27.6 28 26.8 39" />',
      '<path d="M37 5 C35.7 17 37.7 28 36.8 40" />',
      '<path d="M4 35 C14 25 25 16 41 7" />'
    ];

    // A partial group is only as wide as the strokes it actually holds. It used
    // to be a full five-mark box whatever was drawn in it, so a group of one
    // carried four marks' worth of empty paper and pushed whatever followed it
    // away from the count. The fifth mark is the diagonal, which needs the whole
    // box back.
    const strokes = Math.max(1, Math.min(5, Number(count) || 0));
    const viewWidth = strokes < 5 ? strokes * 10 + 4 : 48;

    // width/height as attributes, not only a viewBox: an SVG with no intrinsic
    // size resolves `width: auto` against its containing block, which inside a
    // content-sized flex row settles at zero.
    return `
      <svg class="pick-tally-group" viewBox="0 0 ${viewWidth} 44"
           width="${viewWidth}" height="44" focusable="false">
        ${marks.slice(0, count).join('')}
      </svg>`;
  }

  function setCountText(message) {
    const el = document.getElementById('pickClipboardCount');
    if (!el) return;

    el.classList.remove('pick-clipboard-count-tally');
    el.classList.add('pick-clipboard-count-text');
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
