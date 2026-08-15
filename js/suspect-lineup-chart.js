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
  let fitNamesFrame = 0;

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
    loadLineup();
    window.addEventListener('ff-auth-changed', loadLineup);
    window.addEventListener('resize', scheduleFitTrackerNames);
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
    scheduleFitTrackerNames(list);
    document.fonts?.ready?.then(() => scheduleFitTrackerNames(list)).catch(() => {});
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
            <strong class="lineup-booking-name">${escapeHtml(row.username)}</strong>
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
        <span class="lineup-pool-corner">SUSPECT TRACKER</span>
        ${POOL_WEEKS.map((week) => weekHeaderHtml(week)).join('')}
      </li>
    `;
  }

  function weekHeaderHtml(week) {
    const currentClass = week === currentPoolWeek() ? ' lineup-week-label-current' : '';
    return `<span class="lineup-week-label${currentClass}" data-lineup-week="${week}">W${week}</span>`;
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

  function scheduleFitTrackerNames(root = document) {
    window.cancelAnimationFrame(fitNamesFrame);
    fitNamesFrame = window.requestAnimationFrame(() => fitTrackerNames(root));
  }

  function fitTrackerNames(root = document) {
    // The first-name line shrinks by the same rule as the username above it,
    // so a long name narrows rather than clipping.
    const names = root.querySelectorAll('.lineup-booking-name, .lineup-booking-first');
    for (const el of names) {
      el.style.fontSize = '';
      const maxPx = parseFloat(window.getComputedStyle(el).fontSize) || 14;
      const minPx = 5.5;

      for (let size = maxPx; size >= minPx; size -= 0.5) {
        el.style.fontSize = `${size}px`;
        if (el.scrollWidth <= el.clientWidth) break;
      }
    }
  }

  function paintTrackerThemes(root = document) {
    for (const card of root.querySelectorAll('.lineup-booking-card')) {
      const img = card.querySelector('.lineup-tracker-mugshot');
      if (!img) continue;

      const ready = img.complete && img.naturalWidth
        ? Promise.resolve()
        : img.decode().catch(() => null);

      ready.then(() => {
        const colors = dominantPair(img);
        if (!colors) return;

        card.style.setProperty('--tracker-primary', colors[0]);
        card.style.setProperty('--tracker-secondary', colors[1]);
        card.style.setProperty('--tracker-ink', textColorFor(colors[0]));
      }).catch(() => {});
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

  function textColorFor(cssRgb) {
    const channels = cssRgb.match(/\d+/g)?.map(Number) || [255, 255, 255];
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
