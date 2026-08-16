// ===== SUSPECT PICK POOL =====
// Every rostered suspect gets a full 18-week pool card under the legal pad.
(function () {
  const LINEUP_CONFIG = window.FF_SUPABASE_CONFIG || {};
  const LINEUP_SUPABASE_URL = LINEUP_CONFIG.url || 'https://qmaafbncpzrdmqapkkgr.supabase.co';
  const LINEUP_SUPABASE_ANON_KEY = LINEUP_CONFIG.publishableKey || 'sb_publishable_6a9XqxYa0-AZtyrwz4ZeUg_aiMsVH-3';
  const PROFILES_TABLE = LINEUP_CONFIG.tables?.profiles || 'ff_profiles';
  const PICKS_TABLE = LINEUP_CONFIG.tables?.picks || 'ff_picks';
  const ACTIVE_PICKS_VIEW = LINEUP_CONFIG.views?.activePicks || 'ff_active_picks';
  const CURRENT_SUSPECTS_VIEW = LINEUP_CONFIG.views?.currentSuspects || 'ff_current_suspects';
  const DEFAULT_MUGSHOT_URL = new URL('../src/generated/mugshot-placeholder.svg', window.location.href).href;
  const TOTAL_WEEKS = 18;
  const POOL_WEEKS = Array.from({ length: TOTAL_WEEKS }, (_, index) => index + 1);
  const THEME_SAMPLE_SIZE = 24;
  const SKIP_RESULT = 'SKIP';
  const NFL_SHIELD_ICON_SRC = new URL('../src/generated/nfl-shield.png', window.location.href).href;
  const DOT_TEXT_ROWS = 7;
  const DOT_TEXT_PITCH = 4;
  // Bold, in the only way a dot-matrix printer can be: fatter dots, same grid.
  // 1.15 left daylight between neighbours and read as a faint draft pass; 1.5
  // against a pitch of 4 leaves the dots just touching, which is what a real
  // double-strike looks like. Any higher and the counters in 8, 0 and B fill in.
  const DOT_TEXT_RADIUS = 1.5;
  const DOT_TEXT_PAD = 1;
  const DOT_TEXT_CHAR_GAP = 1;
  const DOT_TEXT_SPACE_WIDTH = 3;
  // 5x7, the cell a real dot-matrix head prints. Started as just the letters in
  // SUSPECT TRACKER; the rest arrived when the booking names moved to dots too,
  // so it now covers everything a username can legally contain — letters,
  // digits and the underscore (see the rules in js/join.js). The nine original
  // glyphs are untouched, because the title is drawn from them and any redraw
  // would show up as the heading changing shape.
  const DOT_TEXT_FONT = {
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
    C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
    D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
    G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
    H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
    I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
    J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
    K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
    L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
    O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
    R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
    V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
    W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
    X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
    Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
    Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
    0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
    1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    3: ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
    4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
    7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
    // Underscore sits on the bottom row, so a name like a_little_stitious
    // still reads as separate words at two dots high.
    _: ['00000', '00000', '00000', '00000', '00000', '00000', '11111'],
    '-': ['00000', '00000', '00000', '01110', '00000', '00000', '00000'],
    '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
    '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100']
  };

  const lineupDb = window.supabase
    ? window.supabase.createClient(LINEUP_SUPABASE_URL, LINEUP_SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          storageKey: LINEUP_CONFIG.storageKey || 'law-order-svu-auth-qmaafbncpzrdmqapkkgr',
          storage: window.localStorage
        }
      })
    : null;

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('suspectLineupChart')) return;

    renderLoading();
    // The legend is static markup, so it is printed once here rather than
    // waiting on the pool to load.
    paintDotMatrixLabels();
    loadLineup();
    window.addEventListener('ff-auth-changed', loadLineup);
    // No resize handler any more: every label is an SVG that rescales itself,
    // so there is nothing left to re-measure when the window changes.
  });

  async function loadLineup() {
    if (!lineupDb) {
      setStatus('Pick pool is unavailable.', 'bad');
      return;
    }

    setStatus('Loading pool...', '');

    // First names are for the league, not for passers-by: the same rule the
    // lineup room runs on (js/suspects.js). Signed out, the column is never
    // asked for, so there is nothing to leak.
    const { data: { user } } = await lineupDb.auth.getUser();
    const showFirstNames = Boolean(user);

    const [profilesResult, picksResult] = await Promise.all([
      fetchProfiles(showFirstNames),
      fetchPicks()
    ]);

    if (profilesResult.error || picksResult.error) {
      const error = profilesResult.error || picksResult.error;
      const code = error?.code ? ` (${error.code})` : '';
      setStatus(`Pick pool fetch failed: ${error?.message || 'Unknown error'}${code}`, 'bad');
      console.error('Suspect pick pool failed:', { profilesResult, picksResult });
      return;
    }

    const rows = buildRows(profilesResult.data || [], picksResult.data || []);
    renderRows(rows);
  }

  async function fetchProfiles(showFirstNames) {
    const fromTable = await fetchProfilesFrom(PROFILES_TABLE, showFirstNames);
    if (!fromTable.error) return fromTable;

    console.warn('Pick pool: profiles table failed, trying current suspects view:', fromTable.error);
    return await fetchProfilesFrom(CURRENT_SUSPECTS_VIEW, showFirstNames);
  }

  // Both optional columns are nice-to-haves, so neither is allowed to take the
  // tracker down with it. first_name is dropped on any error rather than on a
  // recognised one: it is granted per role, and a role without it is refused
  // with a message that names no column at all.
  async function fetchProfilesFrom(source, showFirstNames) {
    const select = (first, avatar) => {
      const fields = ['id', 'username'];
      if (first) fields.push('first_name');
      if (avatar) fields.push('avatar_data_url');
      return fields.join(', ');
    };

    const read = (first, avatar) => lineupDb
      .from(source)
      .select(select(first, avatar))
      .order('username', { ascending: true });

    let result = await read(showFirstNames, true);
    if (!result.error) return result;

    if (showFirstNames) {
      result = await read(false, true);
      if (!result.error) return result;
    }

    if (optionalColumnError(result.error, 'avatar_data_url')) {
      result = await read(false, false);
    }

    return result;
  }

  async function fetchPicks() {
    let result = await lineupDb
      .from(ACTIVE_PICKS_VIEW)
      .select('user_id, username, team, week, result, season, created_at, submitted_at_utc');

    if (!result.error) return result;

    console.warn('Pick pool: active picks view failed, using the table:', result.error);
    result = await lineupDb
      .from(PICKS_TABLE)
      .select('*');

    return result;
  }

  function buildRows(profiles, picks) {
    const activePicks = activePicksFromHistory(picks);
    const rows = (profiles || [])
      .filter((profile) => displayName(profile))
      .map((profile) => {
        const profilePicks = picksForProfile(profile, activePicks);
        const picksByWeek = new Map(profilePicks.map((pick) => [Number(pick.week), pick]));
        const picksIn = profilePicks.length;
        const wins = profilePicks.filter(isWin).length;
        const completed = profilePicks.filter(isCompletedResult).length;

        return {
          id: profile.id || '',
          username: displayName(profile),
          // Empty whenever the viewer is signed out, or the column was dropped
          // on the way in. The line is then not rendered at all.
          firstName: String(profile.first_name || '').trim(),
          avatarSrc: safeAvatarSrc(profile.avatar_data_url) || DEFAULT_MUGSHOT_URL,
          picksByWeek,
          picksIn,
          wins,
          completed
        };
      });

    const shouldRankByWins = rows.some((row) => row.completed > 0);
    rows.sort((a, b) => {
      if (shouldRankByWins && b.wins !== a.wins) return b.wins - a.wins;
      return a.username.localeCompare(b.username, undefined, { sensitivity: 'base' });
    });

    return rows;
  }

  function picksForProfile(profile, picks) {
    const id = String(profile.id || '');
    const username = usernameKey(profile.username);

    return picks.filter((pick) => {
      const pickUserId = String(pick.user_id || '');
      if (id && pickUserId && id === pickUserId) return true;
      return username && username === usernameKey(pick.username);
    });
  }

  function activePicksFromHistory(picks) {
    const latestByUserWeek = new Map();

    for (const pick of (picks || []).filter(isCurrentSeasonPick)) {
      const week = Number(pick.week);
      if (!week || !pick.team) continue;

      const key = `${pick.user_id || usernameKey(pick.username) || 'unknown'}:${week}`;
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

  function isWin(pick) {
    return resultText(pick).includes('survived');
  }

  function isCompletedResult(pick) {
    const result = resultText(pick);
    return result.includes('survived') || result.includes('dun dun');
  }

  function resultText(pick) {
    return String(pick?.result || '').trim().toLowerCase();
  }

  function renderRows(rows) {
    const list = document.getElementById('suspectLineupChartList');
    const title = document.getElementById('suspectLineupChartTitle');
    if (!list) return;

    if (title) {
      title.textContent = 'SUSPECT TRACKER';
    }

    if (!rows.length) {
      setStatus('No picks on the board yet.', '');
      list.innerHTML = '';
      return;
    }

    list.innerHTML = `
      ${poolHeaderHtml()}
      ${rows.map(rowHtml).join('')}
    `;
    setStatus('', '');
    bindLegalPadLinks(list);
    paintTrackerThemes(list);
    paintDotMatrixLabels(list);
  }

  function renderLoading() {
    const list = document.getElementById('suspectLineupChartList');
    if (!list) return;

    list.innerHTML = `
      ${poolHeaderHtml()}
      <li class="lineup-chart-row lineup-chart-row-loading" data-picks-in="0">
        <div class="lineup-booking-card">Loading pool...</div>
        ${POOL_WEEKS.map((week) => emptyWeekBlockHtml(week)).join('')}
      </li>
    `;
  }

  function rowHtml(row) {
    return `
      <li class="lineup-chart-row" data-picks-in="${row.picksIn}" data-weeks-won="${row.wins}"
          data-username="${escapeHtml(row.username)}"
          aria-label="${escapeHtml(row.username)}">
        <div class="lineup-booking-card">
          <button class="lineup-tracker-mugshot-button" type="button"
                  data-mugshot-lightbox
                  data-mugshot-src="${escapeHtml(row.avatarSrc)}"
                  data-mugshot-alt="${escapeHtml(`${row.username} mugshot`)}"
                  data-mugshot-caption="${escapeHtml(row.username)}"
                  aria-label="${escapeHtml(`Open ${row.username} mugshot`)}">
            <img class="lineup-tracker-mugshot" src="${escapeHtml(row.avatarSrc)}" alt="${escapeHtml(`${row.username} mugshot`)}" width="38" height="38"/>
          </button>
          <div class="lineup-booking-id">
            <strong class="lineup-booking-name" aria-label="${escapeHtml(row.username)}">${dotMatrixTextHtml(row.username, 'lineup-booking-name')}</strong>
            ${row.firstName ? `<span class="lineup-booking-first">${escapeHtml(row.firstName)}</span>` : ''}
          </div>
        </div>
        ${POOL_WEEKS.map((week) => weekBlockHtml(row, week)).join('')}
      </li>
    `;
  }

  function poolHeaderHtml() {
    return `
      <li class="lineup-pool-header" aria-hidden="true">
        <span class="lineup-pool-corner" aria-label="SUSPECT TRACKER">${dotMatrixTextHtml('SUSPECT TRACKER')}</span>
        ${POOL_WEEKS.map((week) => weekHeaderHtml(week)).join('')}
      </li>
    `;
  }

  // `variant` only names the CSS hooks. The geometry is identical everywhere,
  // so the heading and the booking names are the same printer at two sizes
  // rather than two typefaces that happen to both be dotty.
  function dotMatrixTextHtml(value, variant = 'lineup-pool-corner') {
    const layout = dotMatrixLayout(value);
    const viewWidth = (layout.width - 1) * DOT_TEXT_PITCH + DOT_TEXT_RADIUS * 2 + DOT_TEXT_PAD * 2;
    const viewHeight = (DOT_TEXT_ROWS - 1) * DOT_TEXT_PITCH + DOT_TEXT_RADIUS * 2 + DOT_TEXT_PAD * 2;
    const dots = layout.dots.map((dot) => `
          <circle cx="${DOT_TEXT_PAD + DOT_TEXT_RADIUS + dot.x * DOT_TEXT_PITCH}"
                  cy="${DOT_TEXT_PAD + DOT_TEXT_RADIUS + dot.y * DOT_TEXT_PITCH}"
                  r="${DOT_TEXT_RADIUS}"></circle>`).join('');

    // width/height attributes as well as the viewBox, and they are load-bearing:
    // an SVG carrying only a viewBox has no intrinsic size, so `width: auto`
    // resolves against the containing block. Inside anything sized to its
    // content — a max-content grid column, say — that is circular, and the
    // browser settles it at zero. The label vanishes. With real dimensions the
    // element has an intrinsic box to be measured at, and the CSS ceilings then
    // scale it down from there.
    return `
        <svg class="${variant}-dot-svg" viewBox="0 0 ${viewWidth} ${viewHeight}"
             width="${viewWidth}" height="${viewHeight}"
             preserveAspectRatio="xMinYMid meet" aria-hidden="true" focusable="false">
          <g class="${variant}-dot">${dots}
          </g>
        </svg>`;
  }

  function dotMatrixLayout(value) {
    const dots = [];
    let cursor = 0;

    Array.from(String(value || '').trim().toUpperCase()).forEach((char) => {
      if (char === ' ') {
        cursor += DOT_TEXT_SPACE_WIDTH + DOT_TEXT_CHAR_GAP;
        return;
      }

      const rows = DOT_TEXT_FONT[char] || DOT_TEXT_FONT['?'];
      rows.forEach((row, y) => {
        Array.from(row).forEach((slot, x) => {
          if (slot === '1') dots.push({ x: cursor + x, y });
        });
      });
      cursor += rows[0].length + DOT_TEXT_CHAR_GAP;
    });

    return {
      dots,
      width: Math.max(cursor - DOT_TEXT_CHAR_GAP, 1)
    };
  }

  // Just the number, printed large. The W is dropped because the column is
  // already eighteen numbers in a row under a heading that says what they are —
  // it was eighteen copies of a letter nobody needed to read. Screen readers
  // still get "Week 12" from the aria-label, which is the one place the word
  // still earns its keep.
  function weekHeaderHtml(week) {
    const currentClass = week === currentPoolWeek() ? ' lineup-week-label-current' : '';
    return `<span class="lineup-week-label${currentClass}" data-lineup-week="${week}"
                  aria-label="Week ${week}">${dotMatrixTextHtml(String(week), 'lineup-week-label')}</span>`;
  }

  function currentPoolWeek() {
    const week = Number(window.CURRENT_WEEK || 1);
    if (!Number.isFinite(week)) return 1;
    return Math.min(TOTAL_WEEKS, Math.max(1, Math.round(week)));
  }

  function weekBlockHtml(row, week) {
    const pick = row.picksByWeek.get(week);
    if (!pick) return emptyWeekBlockHtml(week, row.username);
    return pickWeekBlockHtml(row, pick, week);
  }

  function pickWeekBlockHtml(row, pick, week) {
    const username = row.username;
    const fallbackId = `pick-clipboard-w${week}-${anchorSlug(username)}`;
    const targetId = window.PickClipboard?.anchorIdFor?.(username, week) || fallbackId;
    const team = pick.team ? `, ${pick.team}` : '';
    const resultClass = pickResultClass(pick);

    return `
      <a class="lineup-week-block lineup-week-block-pick ${resultClass}"
         href="#${escapeHtml(targetId)}"
         data-lineup-pick-link
         data-lineup-username="${escapeHtml(username)}"
         data-lineup-week="${week}"
         aria-label="${escapeHtml(`${username} Week ${week} pick on the legal pad${team}. ${pickResultLabel(pick)}`)}"
         title="${escapeHtml(`Week ${week}${team}`)}">${pickMarkerHtml(pick)}</a>
    `;
  }

  function emptyWeekBlockHtml(week, username) {
    const label = username
      ? `${username} has no Week ${week} pick. Go to Week ${week} victims.`
      : `Go to Week ${week} victims`;

    return `
      <a class="lineup-week-block lineup-week-block-empty"
         href="${escapeHtml(victimsWeekHref(week))}"
         aria-label="${escapeHtml(label)}"
         title="${escapeHtml(`Week ${week} victims`)}"></a>
    `;
  }

  function victimsWeekHref(week) {
    return `../victims/index.html?week=${encodeURIComponent(String(week))}`;
  }

  function pickMarkerHtml(pick) {
    const team = teamForPick(pick);
    const src = team ? teamLogoSrc(team.abbr) : NFL_SHIELD_ICON_SRC;
    const label = team ? `${team.name} logo` : 'NFL shield';
    const markerText = pickMarkerText(pick);
    return `
      <span class="lineup-logo-marker">
        <img class="lineup-team-logo" src="${escapeHtml(src)}" alt="${escapeHtml(label)}" loading="lazy" decoding="async"/>
        <span class="lineup-logo-marker-text" aria-hidden="true">${markerText}</span>
      </span>
    `;
  }

  function pickMarkerText(pick) {
    const result = resultText(pick);
    if (result.includes('survived')) return 'LOST';
    if (result.includes('dun dun')) return 'WON';
    return 'LOSE';
  }

  function teamForPick(pick) {
    const pickedName = normalizeTeamName(pick?.team);
    if (!pickedName) return null;

    return availableTeams().find((team) => normalizeTeamName(team.name) === pickedName) || null;
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

  function pickResultClass(pick) {
    const result = resultText(pick);
    if (result.includes('survived')) return 'lineup-week-block-survived';
    if (result.includes('dun dun')) return 'lineup-week-block-dun-dun';
    return 'lineup-week-block-pending';
  }

  function pickResultLabel(pick) {
    const result = resultText(pick);
    if (result.includes('survived')) return 'NFL team lost.';
    if (result.includes('dun dun')) return 'NFL team won.';
    return 'Pending result.';
  }

  function bindLegalPadLinks(list) {
    if (list.dataset.lineupLinksBound === 'true') return;
    list.dataset.lineupLinksBound = 'true';

    list.addEventListener('click', (event) => {
      const link = event.target.closest('[data-lineup-pick-link]');
      if (!link) return;

      const username = link.getAttribute('data-lineup-username');
      const week = Number(link.getAttribute('data-lineup-week') || 1);
      if (!username || !window.PickClipboard?.showWeek) return;

      event.preventDefault();
      window.PickClipboard.showWeek(week, username);
    });
  }

  // The rest of the board's type. The legend and the cell captions live in the
  // page markup rather than in these templates, so they are converted in place
  // after render instead of being templated — with the script blocked the page
  // still reads as ordinary text, which is the state the markup is written for.
  //
  // Each one keeps its words on an aria-label, because the dots themselves are
  // aria-hidden and a grid of circles says nothing to a screen reader.
  const DOT_LABEL_SELECTORS = [
    '.lineup-booking-first',
    '.lineup-logo-marker-text',
    '.lineup-emoji-key dd'
  ];

  function paintDotMatrixLabels(root = document) {
    const scope = root === document ? document : root;
    const targets = DOT_LABEL_SELECTORS.flatMap((selector) => [
      ...scope.querySelectorAll(selector),
      // The legend sits outside the list that renderRows() redraws, so a scoped
      // call would never reach it.
      ...(scope === document ? [] : document.querySelectorAll(selector))
    ]);

    for (const el of new Set(targets)) {
      if (el.dataset.dotPainted === 'true') continue;

      const text = (el.textContent || '').trim();
      if (!text) continue;

      el.dataset.dotPainted = 'true';
      if (el.getAttribute('aria-hidden') !== 'true') el.setAttribute('aria-label', text);
      // Variant names get "-dot-svg" and "-dot" appended, so this is the class
      // pair .lineup-label-dot-svg / .lineup-label-dot.
      el.innerHTML = dotMatrixTextHtml(text, 'lineup-label');
    }
  }

  function paintTrackerThemes(root = document) {
    for (const card of root.querySelectorAll('.lineup-booking-card')) {
      const img = card.querySelector('.lineup-tracker-mugshot');
      if (!img) continue;

      const username = card.closest('.lineup-chart-row')?.dataset.username || '';
      const apply = (colors) => {
        if (!colors) return;
        card.style.setProperty('--tracker-primary', colors[0]);
        card.style.setProperty('--tracker-secondary', colors[1]);
        card.style.setProperty('--tracker-ink', textColorFor(colors[0]));
      };

      // A listed suspect skips sampling altogether — see js/suspect-colors.js.
      // Checked before the image is even waited on, so an override paints on
      // the first frame instead of after a decode.
      const override = window.suspectColorOverride?.(username);
      if (override) { apply(override); continue; }

      const ready = img.complete && img.naturalWidth
        ? Promise.resolve()
        : img.decode().catch(() => null);

      ready.then(() => apply(dominantPair(img))).catch(() => {});
    }
  }

  function dominantPair(img) {
    let pixels;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = THEME_SAMPLE_SIZE;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, THEME_SAMPLE_SIZE, THEME_SAMPLE_SIZE);
      pixels = ctx.getImageData(0, 0, THEME_SAMPLE_SIZE, THEME_SAMPLE_SIZE).data;
    } catch (error) {
      return null;
    }

    const buckets = new Map();
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 128) continue;
      const r = pixels[i] >> 5;
      const g = pixels[i + 1] >> 5;
      const b = pixels[i + 2] >> 5;
      const key = (r << 10) | (g << 5) | b;
      const entry = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
      entry.count++;
      entry.r += pixels[i];
      entry.g += pixels[i + 1];
      entry.b += pixels[i + 2];
      buckets.set(key, entry);
    }

    const ranked = [...buckets.values()]
      .map((entry) => ({
        count: entry.count,
        r: Math.round(entry.r / entry.count),
        g: Math.round(entry.g / entry.count),
        b: Math.round(entry.b / entry.count)
      }))
      .sort((a, b) => b.count - a.count);

    if (!ranked.length) return null;

    const first = ranked[0];
    const minDistance = 60;
    const second = ranked.find((color) => colorDistance(color, first) > minDistance) || ranked[1] || first;

    return [toCssRgb(first), toCssRgb(second)];
  }

  function colorDistance(a, b) {
    return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
  }

  function toCssRgb(color) {
    return `rgb(${color.r}, ${color.g}, ${color.b})`;
  }

  // Takes either form, because it now gets both: the sampler hands it
  // 'rgb(r, g, b)' off the canvas, while an override from js/suspect-colors.js
  // is a hex string. Scraping digits — which is all this used to do — reads
  // '#FDCB03' as the single number 3, and every hex primary came back needing
  // white ink, including the bright yellow ones.
  function channelsOf(color) {
    const value = String(color || '').trim();

    const hex = value.match(/^#([0-9a-f]{6})$/i);
    if (hex) {
      return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16));
    }

    const parts = value.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number);
    return parts && parts.length === 3 ? parts : null;
  }

  function textColorFor(color) {
    const channels = channelsOf(color);
    // No idea what it is: white ink over an unknown fill is the safer guess,
    // because the fill failed to parse and is most likely the dark default.
    if (!channels) return '#FFFFFF';

    const [r, g, b] = channels;
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.58 ? '#0D0D0D' : '#FFFFFF';
  }

  function setStatus(message, kind) {
    const el = document.getElementById('suspectLineupChartStatus');
    if (!el) return;

    el.textContent = message;
    el.classList.remove('lineup-chart-status-good', 'lineup-chart-status-bad');
    if (kind) el.classList.add(`lineup-chart-status-${kind}`);
  }

  function displayName(row) {
    return String(row?.username || '').trim();
  }

  function safeAvatarSrc(value) {
    const src = String(value || '');
    return /^data:image\/(?:png|jpeg|webp);base64,/i.test(src) ? src : '';
  }

  function optionalColumnError(error, columnName) {
    const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
    return (error?.code === 'PGRST204' && text.includes(columnName)) ||
      (error?.code === '42703' && text.includes(columnName)) ||
      (text.includes('column') && text.includes(columnName));
  }

  function usernameKey(value) {
    return String(value || '').trim().toLowerCase();
  }

  function anchorSlug(value) {
    return String(value || 'unknown')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'unknown';
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
