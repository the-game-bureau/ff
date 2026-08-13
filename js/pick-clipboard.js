// ===== PICK CLIPBOARD =====
// The sheet under the docket: current-week picks first, with a week control for
// looking backward or ahead through filed picks.
(function () {
  const PICKBOARD_SUPABASE_URL = 'https://qmaafbncpzrdmqapkkgr.supabase.co';
  const PICKBOARD_SUPABASE_ANON_KEY = 'sb_publishable_6a9XqxYa0-AZtyrwz4ZeUg_aiMsVH-3';
  const ACTIVE_PICKS_VIEW = 'ff_active_picks';
  const PICKS_TABLE = 'ff_picks';
  const SKIP_RESULT = 'SKIP';

  const pickboardDb = window.supabase
    ? window.supabase.createClient(PICKBOARD_SUPABASE_URL, PICKBOARD_SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          storageKey: 'law-order-svu-auth-qmaafbncpzrdmqapkkgr',
          storage: window.localStorage
        }
      })
    : null;

  let activePicks = [];
  let selectedWeek = Number(window.CURRENT_WEEK || 1);

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
      .sort((a, b) => displayName(a).localeCompare(displayName(b)) || teamName(a).localeCompare(teamName(b)));

    renderPickTally(weekPicks.length);

    if (!weekPicks.length) {
      body.innerHTML = `<tr><td colspan="4" class="pick-clipboard-empty">No picks filed for Week ${selectedWeek}.</td></tr>`;
      return;
    }

    body.innerHTML = weekPicks.map((pick) => `
      <tr>
        <td data-label="Suspect">${escapeHtml(displayName(pick))}</td>
        <td data-label="Victim">
          <span class="pick-clipboard-line">
            <span class="pick-clipboard-team">${escapeHtml(teamName(pick))}</span>
            <span class="pick-clipboard-score">00</span>
          </span>
          <span class="pick-clipboard-line">
            <span class="pick-clipboard-matchup">${escapeHtml(matchupText(pick))}</span>
            <span class="pick-clipboard-score">00</span>
          </span>
        </td>
        <td class="pick-clipboard-time" data-label="Filed">${escapeHtml(stamp(pick))}</td>
        <td class="pick-clipboard-verdict" data-label="Result">${verdictMark(pick)}</td>
      </tr>
    `).join('');
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
    return new Date(pick?.submitted_at_utc || pick?.created_at || 0).getTime();
  }

  function displayName(pick) {
    return String(pick?.username || '(unknown)').trim() || '(unknown)';
  }

  function teamName(pick) {
    return String(pick?.team || '').trim();
  }

  // Marked by hand, in a second pen: green tick if the victim went down and the
  // suspect walks, red X if the case closed on them. A pick with no result yet
  // is left blank — the line is waiting to be marked, and a placeholder there
  // would read as a verdict.
  //
  // Drawn as strokes rather than typed as ✓ and ✗, so they sit on the page like
  // the rest of the pen work instead of like font glyphs.
  function verdictMark(pick) {
    const result = String(pick?.result || '').trim().toLowerCase();

    if (result.includes('survived')) {
      return `
        <svg class="pick-mark pick-mark-tick" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <path d="M5 17.5 C8.5 20 11 23.5 12.5 26.5 C16 18 21.5 10 28.5 4.5"/>
        </svg>
        <span class="sr-only">Survived</span>`;
    }

    if (result.includes('dun dun')) {
      return `
        <svg class="pick-mark pick-mark-cross" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <path d="M6 5.5 C12 11.5 20 20 26.5 27"/>
          <path d="M26 6 C20 12 11.5 20.5 5.5 26.5"/>
        </svg>
        <span class="sr-only">Dun dun</span>`;
    }

    return '<span class="sr-only">Pending</span>';
  }

  function matchupText(pick) {
    const storedOpponent = String(pick?.opponent || '').trim();
    const storedHomeAway = String(pick?.home_away || '').trim();
    if (storedOpponent) {
      return `${storedHomeAway || 'vs'} ${shortTeamName(storedOpponent)}`;
    }

    const info = window.NFL_SCHEDULE_HELPERS?.getTeamScheduleInfo?.(teamName(pick), Number(pick.week));
    if (!info || info.isBye) return 'BYE';
    return `${info.homeAway} ${info.opponentShort || shortTeamName(info.opponent)}`;
  }

  function shortTeamName(name) {
    const parts = String(name || '').trim().split(/\s+/);
    return parts[parts.length - 1] || '';
  }

  function stamp(pick) {
    const when = pick?.submitted_at_utc || pick?.created_at;
    if (!when) return '-';

    const date = new Date(when);
    if (Number.isNaN(date.getTime())) return '-';

    return date.toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  function countLabel(count) {
    if (!count) return `No Week ${selectedWeek} picks on file.`;
    return `${count} Week ${selectedWeek} ${count === 1 ? 'pick' : 'picks'} on file.`;
  }

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
