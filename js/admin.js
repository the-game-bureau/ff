(function () {
  const ADMIN_SUPABASE_URL = 'https://qmaafbncpzrdmqapkkgr.supabase.co';
  const ADMIN_SUPABASE_ANON_KEY = 'sb_publishable_6a9XqxYa0-AZtyrwz4ZeUg_aiMsVH-3';
  const ADMIN_PROFILE_TABLE = 'ff_profiles';
  const ADMIN_SCHEDULE_TABLE = 'ff_nfl_schedule';
  const ADMIN_ALLOWED_USERNAME = 'theclarinetofjustice';
  const SOURCE_URL = window.NFL_SCHEDULE_SOURCE_URL || 'https://plaintextsports.com/nfl/2026/schedule';
  const SOURCE_SEASON = window.NFL_SCHEDULE_SEASON || 2026;

  const adminDb = window.supabase?.createClient(ADMIN_SUPABASE_URL, ADMIN_SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storageKey: 'law-order-svu-auth-qmaafbncpzrdmqapkkgr',
      storage: window.localStorage,
    },
  });

  const els = {};
  let lastTableRows = null;
  let lastPrompt = '';

  document.addEventListener('DOMContentLoaded', () => {
    els.status = document.getElementById('adminStatus');
    els.tools = document.getElementById('adminTools');
    els.reconcile = document.getElementById('btnReconcileSchedule');
    els.copyPrompt = document.getElementById('btnCopyReconcilePrompt');
    els.summary = document.getElementById('adminSummary');
    els.diffBody = document.getElementById('adminDiffBody');
    els.prompt = document.getElementById('reconcilePrompt');

    els.usersPanel = document.getElementById('adminUsersPanel');
    els.usersStatus = document.getElementById('adminUsersStatus');
    els.usersBody = document.getElementById('adminUsersBody');
    els.refreshUsers = document.getElementById('btnRefreshUsers');
    els.deleteModal = document.getElementById('adminDeleteModal');
    els.deleteSummary = document.getElementById('adminDeleteSummary');
    els.deleteWord = document.getElementById('adminDeleteWord');
    els.deleteConfirm = document.getElementById('adminDeleteConfirm');
    els.deleteError = document.getElementById('adminDeleteError');
    els.confirmDelete = document.getElementById('btnConfirmDelete');

    els.reconcile?.addEventListener('click', reconcileSchedule);
    els.copyPrompt?.addEventListener('click', copyReconcilePrompt);
    els.refreshUsers?.addEventListener('click', loadUsers);

    // Delegated: the rows are rebuilt on every load.
    els.usersBody?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-delete-user]');
      if (button) openDeleteModal(button.dataset.deleteUser, button.dataset.deleteLabel);
    });

    els.confirmDelete?.addEventListener('click', confirmDelete);
    els.deleteConfirm?.addEventListener('input', syncDeleteButton);
    document.getElementById('btnCancelDelete')?.addEventListener('click', closeDeleteModal);
    document.getElementById('btnAbortDelete')?.addEventListener('click', closeDeleteModal);
    els.deleteModal?.addEventListener('click', (event) => {
      if (event.target === els.deleteModal) closeDeleteModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && els.deleteModal && !els.deleteModal.hidden) closeDeleteModal();
    });

    guardAdmin();

    adminDb?.auth.onAuthStateChange(() => {
      guardAdmin();
    });

    window.addEventListener('ff-auth-changed', () => {
      guardAdmin();
    });
  });

  async function guardAdmin() {
    hideTools();

    if (!adminDb) {
      setAdminStatus('Admin access could not initialize Supabase.', 'bad');
      return;
    }

    setAdminStatus('Checking credentials.', 'note');

    const {
      data: { user },
      error: userError,
    } = await adminDb.auth.getUser();

    if (userError || !user) {
      setAdminStatus('Admin access requires TheClarinetOfJustice to be checked in.', 'bad');
      return;
    }

    const { data: profile, error: profileError } = await adminDb
      .from(ADMIN_PROFILE_TABLE)
      .select('username')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) {
      setAdminStatus(`Profile check failed: ${profileError.message}`, 'bad');
      return;
    }

    const username = String(profile?.username || user.user_metadata?.username || '').trim().toLowerCase();

    if (username !== ADMIN_ALLOWED_USERNAME) {
      setAdminStatus('Access denied. This room is reserved for TheClarinetOfJustice.', 'bad');
      return;
    }

    els.tools.hidden = false;
    if (els.usersPanel) els.usersPanel.hidden = false;
    setAdminStatus('Admin access granted. Schedule audit tools are ready.', 'good');
    await ensurePrompt();
    await loadUsers();
  }

  // ===== ROSTER =====
  // Everything here goes through RPCs that re-check the caller server-side.
  // The publishable key cannot read auth.users directly, and should not be
  // able to; see supabase/sql/ff_admin_delete_user.sql.
  let pendingDelete = null;

  async function loadUsers() {
    if (!adminDb || !els.usersBody) return;

    setUsersStatus('Loading roster.', 'note');

    const { data, error } = await adminDb.rpc('ff_admin_list_users');

    if (error) {
      // A missing function is the common case on a project where the SQL has
      // not been run yet, and it deserves a message that says so.
      const missing = error.code === 'PGRST202' ||
        /could not find the function|does not exist/i.test(error.message || '');
      setUsersStatus(
        missing
          ? 'Roster unavailable: run supabase/sql/ff_admin_delete_user.sql in the SQL editor first.'
          : `Roster failed: ${error.message}${error.code ? ` (${error.code})` : ''}`,
        'bad'
      );
      console.error('ff_admin_list_users failed:', error);
      renderUsers([]);
      return;
    }

    renderUsers(data || []);
    setUsersStatus(`${(data || []).length} league member${(data || []).length === 1 ? '' : 's'}.`, 'good');
  }

  function renderUsers(users) {
    if (!els.usersBody) return;

    if (!users.length) {
      els.usersBody.innerHTML = '<tr><td colspan="5" class="table-empty">No league members.</td></tr>';
      return;
    }

    els.usersBody.innerHTML = users.map((user) => {
      // Every row is a league member: the roster is driven from ff_profiles,
      // so accounts belonging to other sites on this shared project never
      // reach here and cannot be removed by accident.
      const label = user.username || '(no username)';
      const joined = user.created_at ? String(user.created_at).slice(0, 10) : '';

      return `
        <tr>
          <td>${escapeAdminHtml(label)}</td>
          <td>${escapeAdminHtml(user.email || '')}</td>
          <td>${Number(user.pick_count || 0)}</td>
          <td>${escapeAdminHtml(joined)}</td>
          <td>
            <button class="btn btn-secondary btn-mini" type="button"
              data-delete-user="${escapeAdminHtml(user.id)}"
              data-delete-label="${escapeAdminHtml(label)}">Remove</button>
          </td>
        </tr>`;
    }).join('');
  }

  function openDeleteModal(userId, label) {
    if (!els.deleteModal) return;

    pendingDelete = { id: userId, label };

    // Confirm by typing the username. A plain OK button gets clicked through;
    // typing the name forces you to read which record you are destroying.
    els.deleteWord.textContent = label;
    els.deleteSummary.textContent =
      `This removes ${label} from the league: their profile and every pick they made. ` +
      `Their login is kept, so anything they have on another site sharing this project is untouched. ` +
      `The picks cannot be recovered.`;
    els.deleteConfirm.value = '';
    els.deleteError.textContent = '';
    syncDeleteButton();

    els.deleteModal.hidden = false;
    els.deleteConfirm.focus();
  }

  function closeDeleteModal() {
    if (els.deleteModal) els.deleteModal.hidden = true;
    pendingDelete = null;
  }

  function syncDeleteButton() {
    if (!els.confirmDelete || !pendingDelete) return;
    const typed = (els.deleteConfirm?.value || '').trim().toLowerCase();
    els.confirmDelete.disabled = typed !== String(pendingDelete.label).trim().toLowerCase();
  }

  async function confirmDelete() {
    if (!pendingDelete || !adminDb) return;

    els.confirmDelete.disabled = true;
    els.deleteError.textContent = '';

    const { data, error } = await adminDb.rpc('ff_admin_remove_member', {
      target_user_id: pendingDelete.id
    });

    if (error) {
      els.deleteError.textContent = `${error.message}${error.code ? ` (${error.code})` : ''}`;
      console.error('ff_admin_remove_member failed:', error);
      syncDeleteButton();
      return;
    }

    const label = data?.username || data?.email || pendingDelete.label;
    closeDeleteModal();
    setUsersStatus(`Removed ${label} from the league. ${Number(data?.picks_deleted || 0)} pick(s) deleted. Login kept.`, 'good');
    await loadUsers();
  }

  function setUsersStatus(message, kind) {
    if (!els.usersStatus) return;
    els.usersStatus.textContent = message;
    els.usersStatus.classList.remove('join-status-good', 'join-status-bad', 'join-status-note');
    if (kind) els.usersStatus.classList.add(`join-status-${kind}`);
  }

  function escapeAdminHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function reconcileSchedule() {
    setWorking(true);
    renderSummary('Loading schedule table and source schedule.', 'note');

    try {
      const tableRows = await fetchScheduleRows();
      lastTableRows = tableRows;
      lastPrompt = buildReconcilePrompt(tableRows);
      els.prompt.value = lastPrompt;

      let sourceGames;
      try {
        sourceGames = await fetchPlainTextSportsGames();
      } catch (sourceError) {
        renderSummary(
          `Direct fetch failed: ${sourceError.message}. Copy the audit prompt below and run it with web access.`,
          'bad'
        );
        renderFallbackRow('Browser fetch was blocked or failed. The prompt contains the table snapshot.');
        return;
      }

      const sourceRows = expandGamesToRows(sourceGames);
      const diffs = compareScheduleRows(sourceRows, tableRows);
      renderDiffs(diffs, sourceRows.length, tableRows.length);
      lastPrompt = buildReconcilePrompt(tableRows, `In-browser comparison found ${diffs.length} differences.`);
      els.prompt.value = lastPrompt;
    } catch (error) {
      renderSummary(`Schedule audit failed: ${error.message}`, 'bad');
      renderFallbackRow('Could not read the schedule table.');
      lastPrompt = buildReconcilePrompt([], `Schedule table read failed: ${error.message}`);
      els.prompt.value = lastPrompt;
    } finally {
      setWorking(false);
    }
  }

  async function copyReconcilePrompt() {
    setWorking(true);

    try {
      await ensurePrompt();
      els.prompt.focus();
      els.prompt.select();

      try {
        await navigator.clipboard.writeText(lastPrompt);
      } catch (_error) {
        document.execCommand('copy');
      }

      setAdminStatus('Audit prompt copied.', 'good');
    } catch (error) {
      setAdminStatus(`Could not build audit prompt: ${error.message}`, 'bad');
    } finally {
      setWorking(false);
    }
  }

  async function ensurePrompt() {
    if (!lastTableRows) {
      try {
        lastTableRows = await fetchScheduleRows();
      } catch (_error) {
        lastTableRows = [];
      }
    }

    lastPrompt = buildReconcilePrompt(lastTableRows);
    if (els.prompt) {
      els.prompt.value = lastPrompt;
    }
  }

  async function fetchScheduleRows() {
    const { data, error } = await adminDb
      .from(ADMIN_SCHEDULE_TABLE)
      .select('season,week,team,opponent,home_away,kickoff_at_utc,is_tbd,source_url')
      .eq('season', SOURCE_SEASON)
      .order('week', { ascending: true })
      .order('team', { ascending: true });

    if (error) {
      throw error;
    }

    return (data || []).map(normalizeScheduleRow);
  }

  async function fetchPlainTextSportsGames() {
    const response = await fetch(SOURCE_URL, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Plain Text Sports returned HTTP ${response.status}`);
    }

    const html = await response.text();
    const games = parsePlainTextSportsSchedule(html);
    if (!games.length) {
      throw new Error('No regular season games were parsed.');
    }

    return games;
  }

  function parsePlainTextSportsSchedule(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const slugLookup = new Map((window.NFL_TEAMS || []).map((team) => [slugify(team.name), team.name]));
    const games = [];

    for (let week = 1; week <= 18; week += 1) {
      const weekToggle = doc.getElementById(`week${week}`);
      const weekGames = weekToggle?.parentElement?.querySelector('.week-games');
      if (!weekGames) {
        continue;
      }

      Array.from(weekGames.children).forEach((dayBlock) => {
        const pendingTeams = [];
        const nodes = dayBlock.querySelectorAll('a[href*="/teams/"], time[data-format*="game-start-time"]');

        nodes.forEach((node) => {
          if (node.tagName === 'A') {
            const team = teamNameFromHref(node.getAttribute('href'), slugLookup);
            if (team) {
              pendingTeams.push(team);
            }
            return;
          }

          if (node.tagName !== 'TIME' || pendingTeams.length < 2) {
            return;
          }

          const home = pendingTeams.pop();
          const away = pendingTeams.pop();
          const rawKickoff = node.getAttribute('datetime') || '';
          const isTbd = node.textContent.trim().toUpperCase() === 'TBD' || rawKickoff.startsWith('2100-');

          games.push({
            season: SOURCE_SEASON,
            week,
            away,
            home,
            kickoff_at_utc: isTbd ? null : normalizeUtc(rawKickoff),
            is_tbd: isTbd,
          });
        });
      });
    }

    return games;
  }

  function expandGamesToRows(games) {
    return games.flatMap((game) => [
      {
        season: game.season,
        week: game.week,
        team: game.away,
        opponent: game.home,
        home_away: '@',
        kickoff_at_utc: game.kickoff_at_utc,
        is_tbd: Boolean(game.is_tbd),
        source_url: `${SOURCE_URL}#week${game.week}`,
      },
      {
        season: game.season,
        week: game.week,
        team: game.home,
        opponent: game.away,
        home_away: 'vs',
        kickoff_at_utc: game.kickoff_at_utc,
        is_tbd: Boolean(game.is_tbd),
        source_url: `${SOURCE_URL}#week${game.week}`,
      },
    ]);
  }

  function compareScheduleRows(sourceRows, tableRows) {
    const sourceMap = rowsByKey(sourceRows);
    const tableMap = rowsByKey(tableRows);
    const keys = new Set([...sourceMap.keys(), ...tableMap.keys()]);
    const diffs = [];

    Array.from(keys)
      .sort(sortScheduleKey)
      .forEach((key) => {
        const source = sourceMap.get(key);
        const table = tableMap.get(key);
        const [week, team] = key.split('|');

        if (!source) {
          diffs.push({
            type: 'Extra in table',
            week,
            team,
            field: 'row',
            tableValue: summarizeRow(table),
            sourceValue: 'missing',
          });
          return;
        }

        if (!table) {
          diffs.push({
            type: 'Missing in table',
            week,
            team,
            field: 'row',
            tableValue: 'missing',
            sourceValue: summarizeRow(source),
          });
          return;
        }

        ['opponent', 'home_away', 'kickoff_at_utc', 'is_tbd'].forEach((field) => {
          if (String(table[field] ?? '') !== String(source[field] ?? '')) {
            diffs.push({
              type: 'Changed',
              week,
              team,
              field,
              tableValue: table[field] ?? '',
              sourceValue: source[field] ?? '',
            });
          }
        });
      });

    return diffs;
  }

  function rowsByKey(rows) {
    const map = new Map();
    rows.forEach((row) => {
      map.set(`${Number(row.week)}|${row.team}`, row);
    });
    return map;
  }

  function normalizeScheduleRow(row) {
    return {
      season: Number(row.season),
      week: Number(row.week),
      team: row.team,
      opponent: row.opponent,
      home_away: row.home_away,
      kickoff_at_utc: row.is_tbd ? null : normalizeUtc(row.kickoff_at_utc),
      is_tbd: Boolean(row.is_tbd),
      source_url: row.source_url,
    };
  }

  function normalizeUtc(value) {
    if (!value) {
      return null;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return date.toISOString().replace('.000Z', 'Z');
  }

  function teamNameFromHref(href, slugLookup) {
    const slug = String(href || '').split('/').filter(Boolean).pop();
    if (!slug) {
      return '';
    }

    return slugLookup.get(slug) || titleCaseSlug(slug);
  }

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function titleCaseSlug(slug) {
    return String(slug || '')
      .split('-')
      .filter(Boolean)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(' ');
  }

  function summarizeRow(row) {
    if (!row) {
      return '';
    }

    const kickoff = row.is_tbd ? 'TBD' : row.kickoff_at_utc;
    return `${row.home_away} ${row.opponent}, ${kickoff}`;
  }

  function sortScheduleKey(a, b) {
    const [weekA, teamA] = a.split('|');
    const [weekB, teamB] = b.split('|');
    return Number(weekA) - Number(weekB) || teamA.localeCompare(teamB);
  }

  function renderDiffs(diffs, sourceCount, tableCount) {
    const summary = `${diffs.length} difference${diffs.length === 1 ? '' : 's'} found. Source rows: ${sourceCount}. Table rows: ${tableCount}.`;
    renderSummary(summary, diffs.length ? 'bad' : 'good');

    if (!diffs.length) {
      renderFallbackRow('No differences found.');
      return;
    }

    els.diffBody.innerHTML = diffs
      .map(
        (diff) => `
          <tr>
            <td>${escapeHtml(diff.week)}</td>
            <td>${escapeHtml(diff.team)}</td>
            <td>${escapeHtml(diff.type)}</td>
            <td>${escapeHtml(diff.field)}</td>
            <td>${escapeHtml(diff.tableValue)}</td>
            <td>${escapeHtml(diff.sourceValue)}</td>
          </tr>
        `
      )
      .join('');
  }

  function renderFallbackRow(message) {
    if (!els.diffBody) {
      return;
    }

    els.diffBody.innerHTML = `<tr><td colspan="6">${escapeHtml(message)}</td></tr>`;
  }

  function renderSummary(message, kind) {
    if (!els.summary) {
      return;
    }

    els.summary.className = `admin-summary ${statusClass(kind)}`;
    els.summary.textContent = message;
  }

  function setAdminStatus(message, kind) {
    if (!els.status) {
      return;
    }

    els.status.className = `join-status ${statusClass(kind)}`;
    els.status.textContent = message;
  }

  function hideTools() {
    if (els.tools) {
      els.tools.hidden = true;
    }
    // The roster carries emails, so it goes away with everything else the
    // moment the guard stops passing.
    if (els.usersPanel) {
      els.usersPanel.hidden = true;
    }
    closeDeleteModal();
  }

  function setWorking(isWorking) {
    [els.reconcile, els.copyPrompt].forEach((button) => {
      if (button) {
        button.disabled = isWorking;
      }
    });
  }

  function statusClass(kind) {
    if (kind === 'good') {
      return 'admin-diff-ok';
    }

    if (kind === 'bad') {
      return 'admin-diff-bad';
    }

    return 'admin-diff-note';
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function buildReconcilePrompt(tableRows, note = '') {
    const snapshot = JSON.stringify(tableRows || [], null, 2);
    const noteLine = note ? `\nNote from admin page: ${note}\n` : '';

    return `Audit and reconcile the NFL schedule table for The Game Bureau.

Supabase project: qmaafbncpzrdmqapkkgr
Table: public.ff_nfl_schedule
Season: ${SOURCE_SEASON}
Source of truth: ${SOURCE_URL}
Table editor: https://supabase.com/dashboard/project/qmaafbncpzrdmqapkkgr/editor/table/ff_nfl_schedule?schema=public${noteLine}
Task:
1. Fetch the Plain Text Sports schedule page.
2. Parse regular season weeks 1 through 18.
3. Convert each game into two team rows:
   - away team row has home_away = '@' and opponent = home team.
   - home team row has home_away = 'vs' and opponent = away team.
   - kickoff_at_utc is the ISO UTC kickoff time.
   - if Plain Text Sports lists TBD or uses 2100-01-01T05:00:00Z, store kickoff_at_utc as null and is_tbd as true.
   - source_url should be ${SOURCE_URL}#week{week}.
4. Compare those source rows against this current table snapshot.
5. Report missing rows, extra rows, and changed fields.
6. Generate SQL to upsert source rows into public.ff_nfl_schedule. Include deletes only for rows that are definitely extra.

Current public.ff_nfl_schedule snapshot:
${snapshot}`;
  }
})();
