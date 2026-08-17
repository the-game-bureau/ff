// ===== PICK CLIPBOARD =====
// The sheet under the docket: current-week picks first, with a week control for
// looking backward or ahead through filed picks.
(function () {
  const PICKBOARD_CONFIG = window.FF_SUPABASE_CONFIG || {};
  const PICKBOARD_SUPABASE_URL = PICKBOARD_CONFIG.url || 'https://vkoczgzizzppdrpvpemh.supabase.co';
  const PICKBOARD_SUPABASE_ANON_KEY = PICKBOARD_CONFIG.publishableKey || 'sb_publishable_XfvD3zCvnCHT1v_EGE-LJA_3Z9bGjKw';
  const ACTIVE_PICKS_VIEW = PICKBOARD_CONFIG.views?.activePicks || 'ff_active_picks';
  const PICKS_TABLE = PICKBOARD_CONFIG.tables?.picks || 'ff_picks';
  const SKIP_RESULT = 'SKIP';
  const LEGAL_PAD_SCORE_SIMULATIONS = [];

  const pickboardDb = window.supabase
    ? window.supabase.createClient(PICKBOARD_SUPABASE_URL, PICKBOARD_SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          storageKey: PICKBOARD_CONFIG.storageKey || 'law-order-svu-auth-vkoczgzizzppdrpvpemh',
          storage: window.localStorage
        }
      })
    : null;

  let activePicks = [];
  let selectedWeek = Number(window.CURRENT_WEEK || 1);
  let pendingFocus = null;

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('pickClipboard')) return;

    bindControls();
    renderWeekOptions();
    renderClipboard();
    loadPicks();
    window.addEventListener('ff-auth-changed', loadPicks);
  });

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
    const picks = await fetchPicks();
    if (picks === null) {
      setCountText('Clipboard is unavailable.');
      return;
    }

    activePicks = activePicksFromHistory(picks);
    renderWeekOptions();
    renderClipboard();
  }

  async function fetchPicks() {
    let { data, error } = await pickboardDb
      .from(ACTIVE_PICKS_VIEW)
      .select('username, team, week, result, opponent, home_away, created_at, submitted_at_utc');

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

    const weekPicks = activePicks
      .filter((pick) => Number(pick.week) === Number(selectedWeek))
      .sort(compareFiledOldestFirst);

    renderPickTally(weekPicks.length);

    if (!weekPicks.length) {
      body.innerHTML = `<tr><td colspan="4" class="pick-clipboard-empty">No picks filed for Week ${selectedWeek}.</td></tr>`;
      return;
    }

    body.innerHTML = weekPicks.map((pick) => `
      <tr id="${escapeHtml(pickAnchorId(displayName(pick), selectedWeek))}" tabindex="-1">
        <td data-label="Suspect">${escapeHtml(displayName(pick))}</td>
        <td data-label="Victim">
          <span class="pick-clipboard-line pick-clipboard-victim-line">
            <span class="pick-clipboard-victim-name">
              ${victimLogoHtml(pick)}
              <span class="pick-clipboard-team">${escapeHtml(teamName(pick))}</span>
            </span>
            ${scoreHtml(pick, 'victim')}
          </span>
          <span class="pick-clipboard-line pick-clipboard-opponent-line">
            <span class="pick-clipboard-opponent-name">
              ${matchupHtml(pick)}
            </span>
            ${scoreHtml(pick, 'opponent')}
          </span>
        </td>
        <td class="pick-clipboard-time" data-label="Filed">${escapeHtml(stamp(pick))}</td>
        <td class="pick-clipboard-verdict" data-label="Result">${verdictMark(pick)}</td>
      </tr>
    `).join('');

    if (pendingFocus && Number(pendingFocus.week) === Number(selectedWeek)) {
      if (focusPickRow(pendingFocus.username, pendingFocus.week)) {
        pendingFocus = null;
      }
    }
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

  function displayName(pick) {
    return String(pick?.username || '(unknown)').trim() || '(unknown)';
  }

  function teamName(pick) {
    return String(pick?.team || '').trim();
  }

  function scoreHtml(pick, side) {
    const score = pickScore(pick, side);
    const value = score === null ? '00' : String(score);
    return `<span class="pick-clipboard-score">${escapeHtml(value)}</span>`;
  }

  function pickScore(pick, side) {
    const official = officialScore(pick, side);
    if (official !== null) return official;

    return simulatedScore(pick, side);
  }

  function officialScore(pick, side) {
    const game = officialScoreGameForPick(pick);
    if (!game) return null;

    const matchup = matchupDetails(pick);
    const scoreTeam = side === 'victim' ? teamName(pick) : matchup.opponent;
    const score = window.NFL_SCORE_HELPERS?.getTeamScoreFromGame?.(game, scoreTeam);
    return Number.isFinite(Number(score)) ? Number(score) : null;
  }

  function officialScoreGameForPick(pick) {
    const matchup = matchupDetails(pick);
    if (matchup.isBye || !matchup.opponent) return null;

    return window.NFL_SCORE_HELPERS?.getGameForTeams?.(
      teamName(pick),
      matchup.opponent,
      Number(pick?.week || selectedWeek)
    ) || null;
  }

  function simulatedScore(pick, side) {
    const simulation = scoreSimulationForPick(pick);
    if (!simulation) return null;

    const matchup = matchupDetails(pick);
    const scoreTeam = side === 'victim' ? teamName(pick) : matchup.opponent;
    const key = normalizeTeamName(scoreTeam);
    return Object.prototype.hasOwnProperty.call(simulation.scores, key)
      ? simulation.scores[key]
      : null;
  }

  function scoreSimulationForPick(pick) {
    const week = Number(pick?.week || selectedWeek);
    const pickedTeam = normalizeTeamName(teamName(pick));
    const opponent = normalizeTeamName(matchupDetails(pick).opponent);
    if (!week || !pickedTeam || !opponent) return null;

    return LEGAL_PAD_SCORE_SIMULATIONS.find((simulation) => {
      if (Number(simulation.week) !== week) return false;
      const teams = simulation.teams.map(normalizeTeamName);
      return teams.includes(pickedTeam) && teams.includes(opponent);
    }) || null;
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
  function verdictMark(pick) {
    const scored = scoreVerdict(pick);
    if (scored === 'TRUTH') {
      return '<span class="pick-clipboard-verdict-word pick-clipboard-verdict-truth">TRUTH</span>';
    }
    if (scored === 'LIE') {
      return '<span class="pick-clipboard-verdict-word pick-clipboard-verdict-lie">LIE</span>';
    }

    const result = String(pick?.result || '').trim().toLowerCase();

    if (result.includes('survived')) {
      return '<span class="pick-clipboard-verdict-word pick-clipboard-verdict-truth">TRUTH</span>';
    }

    if (result.includes('dun dun')) {
      return '<span class="pick-clipboard-verdict-word pick-clipboard-verdict-lie">LIE</span>';
    }

    return '<span class="sr-only">Pending</span>';
  }

  function scoreVerdict(pick) {
    if (!isPickScoreFinal(pick)) return '';

    const victimScore = pickScore(pick, 'victim');
    const opponentScore = pickScore(pick, 'opponent');
    if (victimScore === null || opponentScore === null) return '';

    return Number(victimScore) < Number(opponentScore) ? 'TRUTH' : 'LIE';
  }

  function isPickScoreFinal(pick) {
    const official = officialScoreGameForPick(pick);
    if (official) return Boolean(official.final);
    return Boolean(scoreSimulationForPick(pick));
  }

  function matchupHtml(pick) {
    const matchup = matchupDetails(pick);
    if (matchup.isBye) return '<span class="pick-clipboard-matchup">BYE</span>';

    const team = teamForName(matchup.opponent);
    const logo = team ? teamLogoHtml(team) : '';
    return `
      <span class="pick-clipboard-matchup-action">lose</span>
      <span class="pick-clipboard-matchup-prefix">${escapeHtml(matchup.homeAway)}</span>
      <span class="pick-clipboard-opponent-team">
        ${logo}
        <span class="pick-clipboard-matchup">${escapeHtml(matchup.shortName)}</span>
      </span>`;
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

  function focusPickRow(username, week) {
    const row = document.getElementById(pickAnchorId(username, week));
    if (!row) return false;

    row.focus({ preventScroll: true });
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.add('pick-clipboard-row-target');
    window.setTimeout(() => row.classList.remove('pick-clipboard-row-target'), 1600);
    return true;
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

    return `
      <svg class="pick-tally-group" viewBox="0 0 48 44" focusable="false">
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
