(function () {
  const ADMIN_CONFIG = window.FF_SUPABASE_CONFIG || {};
  const ADMIN_SUPABASE_URL = ADMIN_CONFIG.url || 'https://qmaafbncpzrdmqapkkgr.supabase.co';
  const ADMIN_SUPABASE_ANON_KEY = ADMIN_CONFIG.publishableKey || 'sb_publishable_6a9XqxYa0-AZtyrwz4ZeUg_aiMsVH-3';
  const ADMIN_PROFILE_TABLE = ADMIN_CONFIG.tables?.profiles || 'ff_profiles';
  const ADMIN_SCHEDULE_TABLE = ADMIN_CONFIG.tables?.schedule || 'ff_nfl_schedule';
  const ADMIN_RPCS = ADMIN_CONFIG.rpcs || {};
  const ADMIN_PROJECT_REF = ADMIN_CONFIG.projectRef || 'qmaafbncpzrdmqapkkgr';
  const ADMIN_SCHEDULE_TABLE_URL = ADMIN_CONFIG.dashboard?.scheduleTableUrl ||
    `https://supabase.com/dashboard/project/${ADMIN_PROJECT_REF}/editor/table/${ADMIN_SCHEDULE_TABLE}?schema=public`;
  const ADMIN_ALLOWED_USERNAME = 'theclarinetofjustice';
  const SOURCE_URL = window.NFL_SCHEDULE_SOURCE_URL || 'https://plaintextsports.com/nfl/2026/schedule';
  const SOURCE_SEASON = window.NFL_SCHEDULE_SEASON || 2026;

  const adminDb = window.supabase?.createClient(ADMIN_SUPABASE_URL, ADMIN_SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storageKey: ADMIN_CONFIG.storageKey || 'law-order-svu-auth-qmaafbncpzrdmqapkkgr',
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
    els.scheduleTableLink = document.getElementById('adminScheduleTableLink');
    els.summary = document.getElementById('adminSummary');
    els.diffBody = document.getElementById('adminDiffBody');
    els.prompt = document.getElementById('reconcilePrompt');

    els.recordsPanel = document.getElementById('adminRecordsPanel');
    els.recordsStatus = document.getElementById('adminRecordsStatus');
    els.recordsBody = document.getElementById('adminRecordsBody');
    els.refreshRecords = document.getElementById('btnRefreshRecords');
    els.archivePanel = document.getElementById('adminArchivePanel');
    els.archiveStatus = document.getElementById('adminArchiveStatus');
    els.archiveBody = document.getElementById('adminArchiveBody');

    els.deleteModal = document.getElementById('adminDeleteModal');
    els.deleteSummary = document.getElementById('adminDeleteSummary');
    els.deleteWord = document.getElementById('adminDeleteWord');
    els.deleteConfirm = document.getElementById('adminDeleteConfirm');
    els.deleteError = document.getElementById('adminDeleteError');
    els.confirmDelete = document.getElementById('btnConfirmDelete');

    els.reconcile?.addEventListener('click', reconcileSchedule);
    els.copyPrompt?.addEventListener('click', copyReconcilePrompt);
    els.refreshRecords?.addEventListener('click', loadRecords);

    // Delegated: the archive rows are rebuilt on every load.
    els.archiveBody?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-copy-invite]');
      if (button) copyInvite(button);
    });

    // Delegated: rows are rebuilt on every load, and each row carries a few
    // controls.
    els.recordsBody?.addEventListener('click', (event) => {
      const save = event.target.closest('[data-save-record]');
      if (save) { saveRecord(save.dataset.saveRecord); return; }

      const remove = event.target.closest('[data-delete-user]');
      if (remove) {
        openDeleteModal(remove.dataset.deleteUser, remove.dataset.deleteLabel);
        return;
      }

      const mugshot = event.target.closest('[data-record-mugshot]');
      if (mugshot) pickRecordMugshot(mugshot.dataset.recordMugshot);
    });

    // Enter saves the row you are in, so a one-field fix does not need a mouse.
    els.recordsBody?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const field = event.target.closest('[data-record-field]');
      if (!field) return;
      event.preventDefault();
      saveRecord(field.closest('tr')?.dataset.recordId);
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

    if (els.scheduleTableLink) {
      els.scheduleTableLink.href = ADMIN_SCHEDULE_TABLE_URL;
    }
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
    if (els.recordsPanel) els.recordsPanel.hidden = false;
    if (els.archivePanel) els.archivePanel.hidden = false;
    setAdminStatus('Admin access granted. Schedule audit tools are ready.', 'good');
    await ensurePrompt();
    await loadRecords();
    await loadArchivePlayers();
  }

  // ===== SUSPECT RECORDS =====
  // Every field on a member's profile except the password, which is a hash and
  // is nobody's business but its owner's. Reads and writes both go through
  // SECURITY DEFINER functions: supabase/sql/ff_own_mugshot_only.sql leaves the
  // browser role able to update one column of its own row and nothing else, so
  // an admin edit cannot go through the table at all.
  // See supabase/sql/ff_admin_edit_profiles.sql.
  const RECORD_FIELDS = ['username', 'first_name', 'last_name', 'email'];
  const MUGSHOT_SIZE = 256;
  const MAX_MUGSHOT_BYTES = 5 * 1024 * 1024;

  // What the server last told us each row holds, so a save can send only what
  // actually changed. Sending everything would rewrite fields nobody touched
  // and turn one careless keystroke into a whole-record edit.
  let recordSnapshot = new Map();
  let recordPicker = null;
  let pendingMugshotId = '';

  async function loadRecords() {
    if (!adminDb || !els.recordsBody) return;

    setRecordsStatus('Loading records.', 'note');

    const { data, error } = await adminDb.rpc(ADMIN_RPCS.adminListProfiles || 'ff_admin_list_profiles');

    if (error) {
      const missing = error.code === 'PGRST202' ||
        /could not find the function|does not exist/i.test(error.message || '');
      setRecordsStatus(
        missing
          ? 'Records unavailable: run supabase/sql/ff_admin_edit_profiles.sql in the SQL editor first.'
          : `Records failed: ${error.message}${error.code ? ` (${error.code})` : ''}`,
        'bad'
      );
      console.error('ff_admin_list_profiles failed:', error);
      renderRecords([]);
      return;
    }

    renderRecords(data || []);
    setRecordsStatus(`${(data || []).length} record${(data || []).length === 1 ? '' : 's'} on file.`, 'good');
  }

  function renderRecords(rows) {
    if (!els.recordsBody) return;

    recordSnapshot = new Map();

    if (!rows.length) {
      els.recordsBody.innerHTML = '<tr><td colspan="8" class="table-empty">No records.</td></tr>';
      return;
    }

    els.recordsBody.innerHTML = rows.map((row) => {
      recordSnapshot.set(row.id, {
        username: row.username || '',
        first_name: row.first_name || '',
        last_name: row.last_name || '',
        // The profile copy is what the site reads; login_email is shown only
        // when the two have drifted apart, because that is a fault worth
        // seeing rather than hiding behind one tidy value.
        email: row.email || row.login_email || '',
        avatar_data_url: row.avatar_data_url || ''
      });

      const drifted = row.email && row.login_email &&
        row.email.toLowerCase() !== row.login_email.toLowerCase();
      const joined = row.created_at ? String(row.created_at).slice(0, 10) : '';
      const mugshot = safeMugshot(row.avatar_data_url);
      const label = row.username || '(no username)';

      return `
        <tr data-record-id="${escapeAdminHtml(row.id)}">
          <td>
            <button class="admin-mugshot" type="button"
                    data-record-mugshot="${escapeAdminHtml(row.id)}"
                    title="Replace mugshot">
              ${mugshot
                ? `<img src="${escapeAdminHtml(mugshot)}" alt="" width="44" height="44"/>`
                : '<span class="admin-mugshot-empty">NONE</span>'}
            </button>
          </td>
          ${RECORD_FIELDS.map((field) => `
          <td><input class="admin-cell-input" type="${field === 'email' ? 'email' : 'text'}"
                     data-record-field="${field}"
                     value="${escapeAdminHtml(recordSnapshot.get(row.id)[field])}"
                     aria-label="${field.replace('_', ' ')} for ${escapeAdminHtml(row.username || 'member')}"/></td>`).join('')}
          <td>${Number(row.pick_count || 0)}</td>
          <td>${escapeAdminHtml(joined)}</td>
          <td>
            <button class="btn btn-secondary btn-mini" type="button"
                    data-save-record="${escapeAdminHtml(row.id)}">Save</button>
            <button class="btn btn-danger btn-mini" type="button"
                    data-delete-user="${escapeAdminHtml(row.id)}"
                    data-delete-label="${escapeAdminHtml(label)}">Remove</button>
            ${drifted ? `<span class="admin-cell-note" title="Login email is ${escapeAdminHtml(row.login_email)}">LOGIN DIFFERS</span>` : ''}
          </td>
        </tr>`;
    }).join('');
  }

  function safeMugshot(value) {
    const src = String(value || '');
    return /^data:image\/(?:png|jpeg|webp);base64,/i.test(src) ? src : '';
  }

  function recordRow(userId) {
    return els.recordsBody?.querySelector(`tr[data-record-id="${userId}"]`) || null;
  }

  // Only the fields that differ from what was loaded. null means "leave alone"
  // to the function, so an untouched field is never rewritten.
  function changedFields(userId) {
    const row = recordRow(userId);
    const before = recordSnapshot.get(userId);
    if (!row || !before) return null;

    const changes = {};
    let count = 0;

    for (const field of RECORD_FIELDS) {
      const input = row.querySelector(`[data-record-field="${field}"]`);
      if (!input) continue;
      const value = input.value.trim();
      if (value === String(before[field] || '').trim()) continue;
      changes[field] = value;
      count++;
    }

    return count ? changes : null;
  }

  async function saveRecord(userId, extra = {}) {
    if (!adminDb || !userId) return;

    const changes = changedFields(userId) || {};
    Object.assign(changes, extra);

    if (!Object.keys(changes).length) {
      setRecordsStatus('Nothing changed on that record.', 'note');
      return;
    }

    setRecordsStatus('Saving record.', 'note');

    const { data, error } = await adminDb.rpc(ADMIN_RPCS.adminUpdateProfile || 'ff_admin_update_profile', {
      target_user_id: userId,
      new_username: changes.username ?? null,
      new_first_name: changes.first_name ?? null,
      new_last_name: changes.last_name ?? null,
      new_email: changes.email ?? null,
      new_avatar_data_url: changes.avatar_data_url ?? null
    });

    if (error) {
      setRecordsStatus(`Save failed: ${error.message}${error.code ? ` (${error.code})` : ''}`, 'bad');
      console.error('ff_admin_update_profile failed:', error);
      return;
    }

    // Reload rather than patch the row in place: the function normalises what
    // it stores (trims, lowercases the email), and the table should show what
    // is actually on file, not what was typed.
    setRecordsStatus(`Saved ${data?.username || 'record'}.`, 'good');
    await loadRecords();
  }

  function pickRecordMugshot(userId) {
    if (!userId) return;
    pendingMugshotId = userId;

    if (!recordPicker) {
      recordPicker = document.createElement('input');
      recordPicker.type = 'file';
      recordPicker.accept = 'image/*';
      recordPicker.style.display = 'none';
      recordPicker.addEventListener('change', async () => {
        const file = recordPicker.files?.[0];
        recordPicker.value = '';
        if (!file || !pendingMugshotId) return;

        try {
          if (!file.type || !file.type.startsWith('image/')) {
            throw new Error('Mugshot must be an image file.');
          }
          if (file.size > MAX_MUGSHOT_BYTES) {
            throw new Error('Mugshot image must be 5 MB or smaller.');
          }
          const dataUrl = await fileToMugshotDataUrl(file);
          await saveRecord(pendingMugshotId, { avatar_data_url: dataUrl });
        } catch (error) {
          setRecordsStatus(error?.message || 'Mugshot could not be read.', 'bad');
        }
      });
      document.body.appendChild(recordPicker);
    }

    recordPicker.click();
  }

  // Same 256px square-on-white the players' own retake produces, so an admin
  // replacement is indistinguishable from one they took themselves.
  function fileToMugshotDataUrl(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();

      image.onload = () => {
        URL.revokeObjectURL(url);

        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        const crop = Math.min(width, height);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = MUGSHOT_SIZE;

        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, MUGSHOT_SIZE, MUGSHOT_SIZE);
        ctx.drawImage(
          image,
          Math.floor((width - crop) / 2),
          Math.floor((height - crop) / 2),
          crop, crop, 0, 0, MUGSHOT_SIZE, MUGSHOT_SIZE
        );

        resolve(canvas.toDataURL('image/jpeg', 0.88));
      };

      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Mugshot image could not be read.'));
      };

      image.src = url;
    });
  }

  function setRecordsStatus(message, kind) {
    if (!els.recordsStatus) return;
    els.recordsStatus.textContent = message;
    els.recordsStatus.classList.remove('join-status-good', 'join-status-bad', 'join-status-note');
    if (kind) els.recordsStatus.classList.add(`join-status-${kind}`);
  }

  // ===== 2025 COLD CASES =====
  // A closed season, so this is a record rather than a tool: nothing here can
  // be edited and the project that served it no longer exists.
  //
  // It comes from the database, not from 2025/data/profiles.json, even though
  // that file is right there. The names and addresses used to live in it, and a
  // file under the served root is public no matter which page fetches it —
  // publishing 32 people's emails to fill in one admin table is not a trade
  // worth making. They sit in ff_archive_players now, behind RLS with no
  // policies and an admin-checked function.
  // See supabase/sql/ff_archive_2025_roster.sql.
  async function loadArchivePlayers() {
    if (!adminDb || !els.archiveBody) return;

    setArchiveStatus('Loading 2025 roster.', 'note');

    const { data, error } = await adminDb.rpc(ADMIN_RPCS.adminListArchivePlayers || 'ff_admin_list_archive_players', {
      target_season: 2025
    });

    if (error) {
      const missing = error.code === 'PGRST202' ||
        /could not find the function|does not exist/i.test(error.message || '');
      setArchiveStatus(
        missing
          ? '2025 roster unavailable: run supabase/sql/ff_archive_2025_roster.sql in the SQL editor first.'
          : `2025 roster failed: ${error.message}${error.code ? ` (${error.code})` : ''}`,
        'bad'
      );
      console.error('ff_admin_list_archive_players failed:', error);
      els.archiveBody.innerHTML = '<tr><td colspan="7" class="table-empty">Not loaded.</td></tr>';
      return;
    }

    const players = data || [];
    renderArchivePlayers(players);
    setArchiveStatus(`${players.length} player${players.length === 1 ? '' : 's'} in the 2025 season.`, 'good');
  }

  function renderArchivePlayers(players) {
    if (!players.length) {
      els.archiveBody.innerHTML = '<tr><td colspan="7" class="table-empty">No 2025 players.</td></tr>';
      return;
    }

    // Already ordered by the function; the index is just a line number.
    els.archiveBody.innerHTML = players.map((player, index) => {
      const joined = player.joined_at ? String(player.joined_at).slice(0, 10) : '';
      // A blank cell reads as a missing person rather than a missing field.
      const gap = '<span class="admin-cell-note">NOT ON FILE</span>';

      return `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeAdminHtml(player.username || '')}</td>
          <td>${player.name ? escapeAdminHtml(player.name) : gap}</td>
          <td>${player.email ? escapeAdminHtml(player.email) : gap}</td>
          <td>${Number(player.pick_count || 0)}</td>
          <td>${escapeAdminHtml(joined)}</td>
          <td>
            <button class="btn btn-secondary btn-mini" type="button"
                    data-copy-invite="${attrText(inviteFor(player))}">Copy</button>
          </td>
        </tr>`;
    }).join('');
  }

  // ===== INVITES =====
  // One text message per 2025 player, ready to paste. Written to be sent from a
  // phone, so it is short, has one link, and leads with the thing that will
  // make them read the rest: how they did.
  const INVITE_URL = 'https://thegamebureau.com/ff/#welcome';
  // The 2025 winner. Their message says so instead of counting weeks — telling
  // the champion how long they lasted would be a strange way to invite them.
  const WINNER_2025 = 'munch';

  function inviteFor(player) {
    // Weeks survived is one fewer than picks made: the last pick is the one
    // that ended it. The winner never lost, so the arithmetic does not apply.
    const weeks = Math.max(0, Number(player.pick_count || 0) - 1);
    const first = String(player.name || player.username || '').trim().split(/\s+/)[0];
    const hello = first ? `${first}, ` : '';

    // Their 2025 handle, offered back to them: it is the name their whole
    // record is under, and half the fun of the bit is the alias.
    const alias = String(player.username || '').trim();

    // The link goes on its own line after a blank one, so every messaging app
    // gives it a preview card instead of burying it mid-sentence.
    if (String(player.username).toLowerCase() === WINNER_2025) {
      return `${hello}it's time to defend your championship. Law & Order: ` +
        `Special Victory Unit, 2026 is here. Everyone has studied the tape and ` +
        `they are coming for you. Defend it as ${alias} or enter witness ` +
        `protection under a new name. Either way, your title is on the line!` +
        `\n\n${INVITE_URL}`;
    }

    // One-pick players would otherwise be told they survived zero weeks, which
    // is both true and unnecessary.
    const record = weeks === 0
      ? 'Last year Week 1 got you, which we have all agreed never to speak of again.'
      : `Last year you lasted ${weeks} week${weeks === 1 ? '' : 's'} before a team ` +
        `you accused had the nerve to win.`;

    return `${hello}you have been summoned. It's time for Law & Order: Special ` +
      `Victory Unit, 2026. ${record} Join as ${alias} or build yourself a whole ` +
      `new persona. Either way it's time for revenge!\n\n${INVITE_URL}`;
  }

  // The invite carries a blank line before the link. Attribute parsing keeps a
  // literal newline, but only by the letter of the spec — encoding it is one
  // character and removes the doubt.
  function attrText(value) {
    return escapeAdminHtml(value).replace(/\n/g, '&#10;');
  }

  async function copyInvite(button) {
    const text = button.dataset.copyInvite || '';
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      // Clipboard access needs a secure context, which rules out plain http on
      // anything but localhost. Fall back to the old selection trick rather
      // than leaving the button doing nothing.
      const scratch = document.createElement('textarea');
      scratch.value = text;
      scratch.setAttribute('readonly', '');
      scratch.style.position = 'fixed';
      scratch.style.opacity = '0';
      document.body.appendChild(scratch);
      scratch.select();
      try {
        document.execCommand('copy');
      } catch (fallbackError) {
        setArchiveStatus('Copy failed. Select the text by hand.', 'bad');
        scratch.remove();
        return;
      }
      scratch.remove();
    }

    // On the button itself, because a status line at the top of a 32-row table
    // is nowhere near the thing that was clicked.
    const original = button.textContent;
    button.textContent = 'Copied';
    window.setTimeout(() => { button.textContent = original; }, 1200);
  }

  function setArchiveStatus(message, kind) {
    if (!els.archiveStatus) return;
    els.archiveStatus.textContent = message;
    els.archiveStatus.classList.remove('join-status-good', 'join-status-bad', 'join-status-note');
    if (kind) els.archiveStatus.classList.add(`join-status-${kind}`);
  }

  // ===== REMOVAL =====
  // Everything here goes through an RPC that re-checks the caller server-side.
  // The publishable key cannot delete league rows directly, and should not be
  // able to; see supabase/sql/ff_admin_delete_user.sql.
  let pendingDelete = null;

  function openDeleteModal(userId, label) {
    if (!els.deleteModal) return;

    pendingDelete = { id: userId, label };

    // Confirm by typing the username. A plain OK button gets clicked through;
    // typing the name forces you to read which record you are destroying.
    els.deleteWord.textContent = label;
    els.deleteSummary.textContent =
      `This removes ${label} from the league: their profile and every pick they made. ` +
      `Their login is kept, so they can still sign in if they need to rejoin later. ` +
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

    const { data, error } = await adminDb.rpc(ADMIN_RPCS.adminRemoveMember || 'ff_admin_remove_member', {
      target_user_id: pendingDelete.id
    });

    if (error) {
      const missing = error.code === 'PGRST202' ||
        /could not find the function|does not exist/i.test(error.message || '');
      els.deleteError.textContent = missing
        ? 'Removal unavailable: run supabase/sql/ff_admin_delete_user.sql in the SQL editor, then reload.'
        : `${error.message}${error.code ? ` (${error.code})` : ''}`;
      console.error('ff_admin_remove_member failed:', error);
      syncDeleteButton();
      return;
    }

    const label = data?.username || data?.email || pendingDelete.label;
    closeDeleteModal();
    await loadRecords();
    setRecordsStatus(`Removed ${label} from the league. ${Number(data?.picks_deleted || 0)} pick(s) deleted. Login kept.`, 'good');
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
    if (els.recordsPanel) {
      els.recordsPanel.hidden = true;
    }
    if (els.archivePanel) {
      els.archivePanel.hidden = true;
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

Supabase project: ${ADMIN_PROJECT_REF}
Table: public.${ADMIN_SCHEDULE_TABLE}
Season: ${SOURCE_SEASON}
Source of truth: ${SOURCE_URL}
Table editor: ${ADMIN_SCHEDULE_TABLE_URL}${noteLine}
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
6. Generate SQL to upsert source rows into public.${ADMIN_SCHEDULE_TABLE}. Include deletes only for rows that are definitely extra.

Current public.${ADMIN_SCHEDULE_TABLE} snapshot:
${snapshot}`;
  }
})();
