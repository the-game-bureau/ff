(function () {
  const ADMIN_CONFIG = window.FF_SUPABASE_CONFIG || {};
  const ADMIN_SUPABASE_URL = ADMIN_CONFIG.url || 'https://vkoczgzizzppdrpvpemh.supabase.co';
  const ADMIN_SUPABASE_ANON_KEY = ADMIN_CONFIG.publishableKey || 'sb_publishable_XfvD3zCvnCHT1v_EGE-LJA_3Z9bGjKw';
  const ADMIN_PROFILE_TABLE = ADMIN_CONFIG.tables?.profiles || 'ff_profiles';
  const ADMIN_RPCS = ADMIN_CONFIG.rpcs || {};
  const ADMIN_PROJECT_REF = ADMIN_CONFIG.projectRef || 'vkoczgzizzppdrpvpemh';
  const ADMIN_DATABASE_URL = ADMIN_CONFIG.dashboard?.databaseUrl ||
    `https://supabase.com/dashboard/project/${ADMIN_PROJECT_REF}/editor/17649?schema=public`;
  const ADMIN_ALLOWED_USERNAME = 'theclarinetofjustice';

  const adminDb = window.supabase?.createClient(ADMIN_SUPABASE_URL, ADMIN_SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storageKey: ADMIN_CONFIG.storageKey || 'law-order-svu-auth-vkoczgzizzppdrpvpemh',
      storage: window.localStorage,
    },
  });

  const els = {};
  // The roster as last loaded, kept whole so the APB can address it. Suspect
  // Records only keeps the editable fields.
  let recordRows = [];
  let adminEmail = '';
  // Which group the draft below the cards was written for, or '' for none.
  let apbKind = '';

  document.addEventListener('DOMContentLoaded', () => {
    els.databasePanel = document.getElementById('adminDatabasePanel');

    els.databaseLink = document.getElementById('adminDatabaseLink');
    els.schedulePanel = document.getElementById('adminSchedulePanel');
    els.weekLinks = document.getElementById('adminWeekLinks');
    els.apbPanel = document.getElementById('adminApbPanel');
    els.apbNoPickTitle = document.getElementById('apbNoPickTitle');
    els.apbAllCount = document.getElementById('apbAllCount');
    els.apbAllNames = document.getElementById('apbAllNames');
    els.apbNoPickCount = document.getElementById('apbNoPickCount');
    els.apbNoPickNames = document.getElementById('apbNoPickNames');
    els.apbAllEmail = document.getElementById('btnApbAllEmail');
    els.apbAllCopy = document.getElementById('btnApbAllCopy');
    els.apbNoPickEmail = document.getElementById('btnApbNoPickEmail');
    els.apbNoPickCopy = document.getElementById('btnApbNoPickCopy');
    els.apbAllTitle = document.getElementById('apbAllTitle');
    els.apbSubject = document.getElementById('apbSubject');
    els.apbBody = document.getElementById('apbBody');
    els.apbSend = document.getElementById('btnApbSend');
    els.apbCopyMessage = document.getElementById('btnApbCopyMessage');
    els.apbDraftNote = document.getElementById('apbDraftNote');

    els.recordsPanel = document.getElementById('adminRecordsPanel');
    els.recordsBody = document.getElementById('adminRecordsBody');
    els.recordsTitle = document.getElementById('adminRecordsTitle');
    els.refreshRecords = document.getElementById('btnRefreshRecords');
    els.archivePanel = document.getElementById('adminArchivePanel');
    els.archiveBody = document.getElementById('adminArchiveBody');

    els.mugshotModal = document.getElementById('mugshotModal');
    els.mugshotTitle = document.getElementById('mugshotTitle');
    els.mugshotCanvas = document.getElementById('mugshotCanvas');
    els.mugshotLoupe = document.getElementById('mugshotLoupe');
    els.mugshotReadout = document.getElementById('mugshotReadout');
    els.mugshotFrame = document.getElementById('mugshotFrame');
    els.mugshotPicker = document.getElementById('mugshotPicker');
    els.mugshotPreview = document.getElementById('mugshotPreview');
    els.mugshotFlags = document.getElementById('mugshotFlags');
    els.saveMugshotColors = document.getElementById('btnSaveMugshotColors');

    els.deleteModal = document.getElementById('adminDeleteModal');
    els.deleteSummary = document.getElementById('adminDeleteSummary');
    els.deleteWord = document.getElementById('adminDeleteWord');
    els.deleteConfirm = document.getElementById('adminDeleteConfirm');
    els.deleteError = document.getElementById('adminDeleteError');
    els.confirmDelete = document.getElementById('btnConfirmDelete');

    els.refreshRecords?.addEventListener('click', loadRecords);

    els.apbAllEmail?.addEventListener('click', () => drawUpApb('named'));
    els.apbNoPickEmail?.addEventListener('click', () => drawUpApb('nopick'));
    els.apbSend?.addEventListener('click', openApbMail);
    els.apbCopyMessage?.addEventListener('click', (event) => copyApbMessageClicked(event.currentTarget));
    els.apbAllCopy?.addEventListener('click', (event) => copyApbAddresses('named', event.currentTarget));
    els.apbNoPickCopy?.addEventListener('click', (event) => copyApbAddresses('nopick', event.currentTarget));

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
      if (mugshot) openMugshotEditor(mugshot.dataset.recordMugshot);
    });

    // Enter saves the row you are in, so a one-field fix does not need a mouse.
    els.recordsBody?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const field = event.target.closest('[data-record-field]');
      if (!field) return;
      event.preventDefault();
      saveRecord(field.closest('tr')?.dataset.recordId);
    });

    document.getElementById('btnCloseMugshot')?.addEventListener('click', closeMugshotEditor);
    document.getElementById('btnReplaceMugshot')?.addEventListener('click', () => {
      if (shot) pickRecordMugshot(shot.userId);
    });
    els.saveMugshotColors?.addEventListener('click', () => saveMugshotColors(false));
    document.getElementById('btnSampleMugshotColors')?.addEventListener('click', () => saveMugshotColors(true));

    els.mugshotPicker?.addEventListener('input', (event) => setMugshotSlot(event.target.value.toUpperCase()));

    els.mugshotModal?.addEventListener('click', (event) => {
      if (event.target === els.mugshotModal) { closeMugshotEditor(); return; }

      const chip = event.target.closest('[data-shot-slot]');
      if (chip) { armMugshotSlot(chip.dataset.shotSlot); return; }

      if (event.target === els.mugshotCanvas) {
        if (!shot?.armed) {
          setMugshotStatus('Arm Primary or Secondary first, then click the mugshot.', 'note');
          return;
        }
        const pixel = mugshotPixelAt(event);
        if (pixel) setMugshotSlot(pixel.hex);
      }
    });

    els.mugshotCanvas?.addEventListener('mousemove', onMugshotMove);
    els.mugshotCanvas?.addEventListener('mouseleave', clearLoupe);

    els.confirmDelete?.addEventListener('click', confirmDelete);
    els.deleteConfirm?.addEventListener('input', syncDeleteButton);
    document.getElementById('btnCancelDelete')?.addEventListener('click', closeDeleteModal);
    document.getElementById('btnAbortDelete')?.addEventListener('click', closeDeleteModal);
    els.deleteModal?.addEventListener('click', (event) => {
      if (event.target === els.deleteModal) closeDeleteModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (els.deleteModal && !els.deleteModal.hidden) closeDeleteModal();
      if (els.mugshotModal && !els.mugshotModal.hidden) closeMugshotEditor();
    });

    guardAdmin();

    adminDb?.auth.onAuthStateChange(() => {
      guardAdmin();
    });

    window.addEventListener('ff-auth-changed', () => {
      guardAdmin();
    });

    if (els.databaseLink) {
      els.databaseLink.href = ADMIN_DATABASE_URL;
    }

    renderWeekLinks();
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

    // The mail client wants a To:. Nobody else belongs there - every recipient
    // is in BCC - so the bulletin goes to the admin, who gets their own copy.
    adminEmail = String(user.email || '').trim();

    if (els.databasePanel) els.databasePanel.hidden = false;
    if (els.recordsPanel) els.recordsPanel.hidden = false;
    if (els.schedulePanel) els.schedulePanel.hidden = false;
    if (els.apbPanel) els.apbPanel.hidden = false;
    if (els.archivePanel) els.archivePanel.hidden = false;
    // Nothing to announce: the panels below only exist for someone who got in,
    // so their being on screen is the message. The status line is kept for the
    // ways in that fail, and hides itself when it has nothing to say.
    setAdminStatus('');
    await loadRecords();
    await loadArchivePlayers();
  }

  // ===== NFL SCHEDULE =====
  // One button per week, out to Plain Text Sports, which is where the schedule
  // gets checked by hand now that the reconcile tool is gone.
  //
  // The weeks come from the generated schedule rather than a hardcoded 18, so
  // this stays right if a season is ever shaped differently. The #week anchor
  // is the form the old reconcile prompt used for the same site.
  function renderWeekLinks() {
    if (!els.weekLinks) return;

    const games = window.NFL_SCHEDULE_GAMES || [];
    const weeks = [...new Set(games.map((game) => Number(game.week)).filter(Boolean))]
      .sort((a, b) => a - b);

    if (!weeks.length) {
      els.weekLinks.innerHTML = '<p class="gate-help">No schedule loaded.</p>';
      return;
    }

    const current = Number(window.CURRENT_WEEK) || 0;
    const base = window.NFL_SCHEDULE_SOURCE_URL || 'https://plaintextsports.com/nfl/2026/schedule';

    els.weekLinks.innerHTML = weeks.map((week) => {
      const isCurrent = week === current;
      return `<a class="btn btn-secondary week-link${isCurrent ? ' week-link-current' : ''}"
                 href="${escapeAdminHtml(base)}#week${week}"
                 target="_blank" rel="noopener noreferrer"
                 ${isCurrent ? 'aria-current="true"' : ''}>Week ${week}</a>`;
    }).join('');
  }

  // ===== SUSPECT RECORDS =====
  // Every field on a member's profile except the password, which is a hash and
  // is nobody's business but its owner's. Reads and writes both go through
  // SECURITY DEFINER functions: supabase/sql/ff_own_mugshot_only.sql leaves the
  // browser role able to update one column of its own row and nothing else, so
  // an admin edit cannot go through the table at all.
  // See supabase/sql/ff_admin_edit_profiles.sql.
  const RECORD_FIELDS = ['username', 'first_name', 'last_name', 'email', 'sms'];
  // type=tel gets a phone keypad on a touch device and stops a browser
  // offering an email autofill for a phone number.
  const RECORD_FIELD_TYPES = { email: 'email', sms: 'tel' };
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

    // The week the APB asks about is the open one, the same week the rest of
    // the site is on - season.js derives it from the schedule.
    const { data, error } = await adminDb.rpc(ADMIN_RPCS.adminListProfiles || 'ff_admin_list_profiles', {
      for_season: Number(window.SEASON) || null,
      for_week: Number(window.CURRENT_WEEK) || null
    });

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
      renderApb();
      return;
    }

    renderRecords(data || []);
    renderApb();
    setRecordsStatus(`${(data || []).length} record${(data || []).length === 1 ? '' : 's'} on file.`, 'good');
  }

  // The heading carries the count, so a collapsed panel still says how many
  // suspects are on file without being opened.
  function renderRecordsTitle() {
    if (!els.recordsTitle) return;
    const n = recordRows.length;
    els.recordsTitle.textContent = n
      ? `FF Players (${n} Suspect${n === 1 ? '' : 's'})`
      : 'FF Players (Suspects)';
  }

  function renderRecords(rows) {
    recordRows = rows || [];
    renderRecordsTitle();

    if (!els.recordsBody) return;

    recordSnapshot = new Map();

    if (!rows.length) {
      els.recordsBody.innerHTML = '<tr><td colspan="9" class="table-empty">No records.</td></tr>';
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
        sms: row.sms || '',
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
          <td><input class="admin-cell-input" type="${RECORD_FIELD_TYPES[field] || 'text'}"
                     data-record-field="${field}"
                     value="${escapeAdminHtml(recordSnapshot.get(row.id)[field])}"
                     aria-label="${field.replace('_', ' ')} for ${escapeAdminHtml(row.username || 'member')}"/></td>`).join('')}
          <td>${Number(row.pick_count || 0)}</td>
          <td>${escapeAdminHtml(joined)}</td>
          <td>
            <span class="admin-record-actions">
              <button class="btn btn-secondary btn-mini" type="button"
                      data-save-record="${escapeAdminHtml(row.id)}">Save</button>
              <button class="btn btn-danger btn-mini" type="button"
                      data-delete-user="${escapeAdminHtml(row.id)}"
                      data-delete-label="${escapeAdminHtml(label)}">Remove</button>
            </span>
            ${drifted ? `<span class="admin-cell-note" title="Login email is ${escapeAdminHtml(row.login_email)}">LOGIN DIFFERS</span>` : ''}
          </td>
        </tr>`;
    }).join('');

    paintRecordStripes();
  }

  // What is on file wins; failing that the photo is sampled, which is exactly
  // the pair openMugshotEditor() would put in front of you - so the stripe in
  // the table is a preview of the stripe in the editor, and a row whose colours
  // nobody has chosen still shows what the sampler makes of it.
  //
  // A suspect with no photo is left alone: the CSS default is the house pair,
  // which is what the public pages fall back to as well.
  function paintRecordStripes() {
    if (!els.recordsBody) return;

    for (const button of els.recordsBody.querySelectorAll('[data-record-mugshot]')) {
      const row = recordRows.find((record) => record.id === button.dataset.recordMugshot);
      if (!row) continue;

      const saved = savedPairOf(row);
      if (saved) {
        stripe(button, saved);
        continue;
      }

      const img = button.querySelector('img');
      if (!img) continue;

      // The thumbnail is a data URL, so nothing taints the canvas and nothing
      // is fetched twice - but it may not have decoded yet on a first render.
      const sample = () => {
        const pair = sampledPairOf(img);
        if (pair) stripe(button, pair);
      };

      if (img.complete && img.naturalWidth) sample();
      else img.addEventListener('load', sample, { once: true });
    }
  }

  function stripe(el, pair) {
    el.style.setProperty('--stripe-a', pair[0]);
    el.style.setProperty('--stripe-b', pair[1]);
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
      new_avatar_data_url: changes.avatar_data_url ?? null,
      new_sms: changes.sms ?? null
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
          const target = pendingMugshotId;
          await saveRecord(target, { avatar_data_url: dataUrl });

          // The editor is almost certainly what opened the picker, and the new
          // photo has to be redrawn and re-sampled before its colours mean
          // anything. loadRecords() has already run inside saveRecord.
          if (shot && shot.userId === target) {
            const row = recordRows.find((record) => record.id === target);
            if (row) await loadMugshotInto(row);
          }
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
    window.ffToast?.(message, kind, 'records');
  }

  // ===== MUGSHOT EDITOR =====
  // One suspect's photo and the two colours their cards are painted in, shown
  // together in front of the photo those colours come off. Replacing the photo
  // used to be a bare file picker on the thumbnail with no preview, and
  // choosing the colours used to be the Colour Lab, a separate panel showing
  // all 32 suspects at once. Both are about a single mugshot, so both are here.
  //
  // The sampler, the loupe and the pixel picking are the Colour Lab's, moved
  // across rather than rewritten.
  const SHOT_PX = 168;      // on-screen size of the pickable mugshot
  const LOUPE_PX = 84;      // on-screen size of the magnifier
  const LOUPE_SRC = 12;     // how many source pixels the magnifier covers
  const SAMPLE_PX = 24;     // the sampler works on a 24x24 reduction
  const MIN_DISTANCE = 60;  // how far apart two sampled colours must be

  // The suspect in front of the editor, or null when it is closed.
  let shot = null;

  const colourDistance = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
  const toHex = (c) => '#' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  const toRgb = (h) => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) });
  const saturationOf = (c) => { const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b); return mx ? (mx - mn) / mx : 0; };

  function inkFor(hex) {
    const c = toRgb(hex);
    return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255 > 0.58 ? '#0D0D0D' : '#FFFFFF';
  }

  const savedPairOf = (row) =>
    row && row.color_primary && row.color_secondary
      ? [row.color_primary, row.color_secondary]
      : null;

  // Every colour in the photo with the share of the frame it covers, biggest
  // first. dominantPair() on the public pages takes the top two of this.
  function bucketsOf(img) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SAMPLE_PX;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, SAMPLE_PX, SAMPLE_PX);
    const px = ctx.getImageData(0, 0, SAMPLE_PX, SAMPLE_PX).data;

    const map = new Map();
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 128) continue;
      const key = ((px[i] >> 5) << 10) | ((px[i + 1] >> 5) << 5) | (px[i + 2] >> 5);
      const entry = map.get(key) || { count: 0, r: 0, g: 0, b: 0 };
      entry.count++; entry.r += px[i]; entry.g += px[i + 1]; entry.b += px[i + 2];
      map.set(key, entry);
    }

    const total = [...map.values()].reduce((n, e) => n + e.count, 0) || 1;
    return [...map.values()]
      .map(e => ({
        share: e.count / total,
        r: Math.round(e.r / e.count),
        g: Math.round(e.g / e.count),
        b: Math.round(e.b / e.count)
      }))
      .sort((a, b) => b.share - a.share);
  }

  // The two the sampler settles on: the biggest colour in the frame, and the
  // biggest one far enough from it to read as a second colour rather than a
  // shade of the first. Shared so the table thumbnails and the editor cannot
  // disagree about what an unpicked photo looks like.
  function distinctPair(ranked) {
    const first = ranked[0];
    const second = ranked.find((c) => colourDistance(c, first) > MIN_DISTANCE) || ranked[1] || first;
    return [first, second];
  }

  function sampledPairOf(img) {
    const ranked = bucketsOf(img);
    return ranked.length ? distinctPair(ranked).map(toHex) : null;
  }

  // Why this photo may be about to produce a bad pair. Worth saying out loud:
  // the whole reason to pick by hand is that the sampler cannot tell a suspect
  // from the wall behind them.
  function mugshotFlags(ranked, first, second) {
    const flags = [];
    if (colourDistance(first, second) < MIN_DISTANCE) {
      flags.push('Only one distinct colour in this photo.');
    }
    if (saturationOf(first) < 0.18 && saturationOf(second) < 0.18) {
      flags.push('Both sampled colours are near-neutral, so the card reads as grey.');
    }
    if (first.share > 0.55) {
      flags.push(Math.round(first.share * 100) + '% of the frame is one colour, probably the background.');
    }
    return flags.join(' ');
  }

  function openMugshotEditor(userId) {
    const row = recordRows.find((record) => record.id === userId);
    if (!row || !els.mugshotModal) return;

    shot = { userId: userId, username: row.username || '', sampled: null, pair: null, armed: null };

    els.mugshotTitle.textContent = row.username || 'Mugshot';
    els.mugshotPreview.querySelector('span').textContent = row.username || '';
    els.mugshotModal.hidden = false;
    setMugshotStatus('');
    clearLoupe();

    loadMugshotInto(row);
  }

  async function loadMugshotInto(row) {
    const ctx = els.mugshotCanvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, SHOT_PX, SHOT_PX);
    els.mugshotFlags.textContent = '';

    const src = safeMugshot(row.avatar_data_url);

    if (!src) {
      shot.sampled = null;
      shot.pair = savedPairOf(row) || ['#1A1A1A', '#F2EFE6'];
      setMugshotStatus('No mugshot on file. Replace Photo to add one.', 'note');
      paintMugshotEditor();
      return;
    }

    const img = new Image();
    img.src = src;
    try {
      await img.decode();
    } catch (error) {
      setMugshotStatus('That mugshot could not be read.', 'bad');
      return;
    }

    // Cover, not fit: the frame is square and so is a stored mugshot, but a
    // photo that is not gets cropped rather than letterboxed.
    const scale = Math.max(SHOT_PX / img.naturalWidth, SHOT_PX / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ctx.drawImage(img, (SHOT_PX - w) / 2, (SHOT_PX - h) / 2, w, h);

    const ranked = bucketsOf(img);
    if (ranked.length) {
      const [first, second] = distinctPair(ranked);
      shot.sampled = [toHex(first), toHex(second)];
      els.mugshotFlags.textContent = mugshotFlags(ranked, first, second);
    }

    // What is on file wins; failing that, what the sampler would have chosen.
    shot.pair = savedPairOf(row) || (shot.sampled ? shot.sampled.slice() : ['#1A1A1A', '#F2EFE6']);
    paintMugshotEditor();
  }

  function paintMugshotEditor() {
    if (!shot || !shot.pair) return;

    const primary = shot.pair[0];
    const secondary = shot.pair[1];

    for (const chip of els.mugshotModal.querySelectorAll('[data-shot-slot]')) {
      chip.style.background = chip.dataset.shotSlot === 'primary' ? primary : secondary;
      chip.classList.toggle('is-armed', shot.armed === chip.dataset.shotSlot);
    }

    for (const hex of els.mugshotModal.querySelectorAll('[data-shot-hex]')) {
      hex.textContent = hex.dataset.shotHex === 'primary' ? primary : secondary;
    }

    els.mugshotPicker.value = shot.armed === 'secondary' ? secondary : primary;

    // The placard stripe down the mugshot, exactly as suspects/ draws it.
    els.mugshotFrame.style.setProperty('--stripe-a', primary);
    els.mugshotFrame.style.setProperty('--stripe-b', secondary);

    // ...and the tracker's booking card, which uses the pair as a fill.
    els.mugshotPreview.style.background = primary;
    els.mugshotPreview.style.color = inkFor(primary);
    els.mugshotPreview.style.borderColor = secondary;
    els.mugshotPreview.querySelector('i').style.color = secondary;
  }

  function armMugshotSlot(slot) {
    if (!shot) return;
    shot.armed = shot.armed === slot ? null : slot;
    paintMugshotEditor();
  }

  function setMugshotSlot(value) {
    if (!shot || !shot.armed) return;
    shot.pair = shot.armed === 'primary'
      ? [value, shot.pair[1]]
      : [shot.pair[0], value];
    paintMugshotEditor();
  }

  function mugshotPixelAt(event) {
    const canvas = els.mugshotCanvas;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    const x = Math.floor((event.clientX - rect.left) * (canvas.width / rect.width));
    const y = Math.floor((event.clientY - rect.top) * (canvas.height / rect.height));
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;

    const data = canvas.getContext('2d', { willReadFrequently: true })
      .getImageData(x, y, 1, 1).data;
    return { x: x, y: y, hex: toHex({ r: data[0], g: data[1], b: data[2] }) };
  }

  function onMugshotMove(event) {
    const pixel = mugshotPixelAt(event);
    if (!pixel) return;

    const loupe = els.mugshotLoupe;
    const ctx = loupe.getContext('2d');
    const half = Math.floor(LOUPE_SRC / 2);
    const cell = LOUPE_PX / LOUPE_SRC;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, LOUPE_PX, LOUPE_PX);
    ctx.drawImage(els.mugshotCanvas, pixel.x - half, pixel.y - half,
      LOUPE_SRC, LOUPE_SRC, 0, 0, LOUPE_PX, LOUPE_PX);
    ctx.strokeStyle = '#C8102E';
    ctx.lineWidth = 2;
    ctx.strokeRect(half * cell, half * cell, cell, cell);

    loupe.classList.add('is-on');
    // Sits in a corner and jumps to the opposite one as the cursor approaches,
    // so it never covers the pixel being aimed at.
    loupe.style.left = (pixel.x > SHOT_PX / 2 ? 4 : SHOT_PX - LOUPE_PX - 4) + 'px';
    loupe.style.top = (pixel.y > SHOT_PX / 2 ? 4 : SHOT_PX - LOUPE_PX - 4) + 'px';

    els.mugshotReadout.querySelector('i').style.background = pixel.hex;
    els.mugshotReadout.querySelector('span').textContent =
      pixel.hex + (shot && shot.armed ? ' - click to take' : ' - arm a chip first');
  }

  function clearLoupe() {
    if (els.mugshotLoupe) els.mugshotLoupe.classList.remove('is-on');
    if (!els.mugshotReadout) return;
    els.mugshotReadout.querySelector('i').style.background = 'transparent';
    els.mugshotReadout.querySelector('span').textContent = 'Hover the mugshot';
  }

  function closeMugshotEditor() {
    if (!els.mugshotModal) return;
    els.mugshotModal.hidden = true;
    shot = null;
  }

  // clearing = hand this suspect back to the sampler, which is what saving a
  // pair that matches the sampled one would mean anyway.
  async function saveMugshotColors(clearing) {
    if (!shot) return;

    const pair = clearing ? null : shot.pair;
    const userId = shot.userId;

    els.saveMugshotColors.disabled = true;
    setMugshotStatus('Saving colours.', 'note');

    const result = await adminDb.rpc(ADMIN_RPCS.adminSetSuspectColors || 'ff_admin_set_suspect_colors', {
      target_user_id: userId,
      new_primary: pair ? pair[0] : null,
      new_secondary: pair ? pair[1] : null
    });

    els.saveMugshotColors.disabled = false;

    if (result.error) {
      const error = result.error;
      const missing = error.code === 'PGRST202' ||
        /could not find the function|does not exist/i.test(error.message || '');
      setMugshotStatus(missing
        ? 'Run supabase/sql/ff_suspect_colors.sql first.'
        : 'Save failed: ' + error.message, 'bad');
      console.error('admin_set_suspect_colors failed:', error);
      return;
    }

    setMugshotStatus(clearing
      ? 'Cleared. This suspect is sampled from their mugshot again.'
      : 'Saved. Live on the Suspects page and the tracker now.', 'good');

    // Reload so the row behind the popup carries what is actually on file.
    await loadRecords();

    if (!shot) return;
    const row = recordRows.find((record) => record.id === userId);
    if (row) {
      shot.pair = savedPairOf(row) || (shot.sampled ? shot.sampled.slice() : shot.pair);
      paintMugshotEditor();
    }
  }

  function setMugshotStatus(message, kind) {
    window.ffToast?.(message, kind, 'mugshot');
  }

  // ===== APB =====
  // An all points bulletin: one message to the whole league, or to just the
  // suspects who still owe the open week a victim.
  //
  // It hands off to the admin's own mail client with a mailto: rather than
  // sending anything itself. There is no server here to send from, the site is
  // static, and the handoff has a real virtue besides: a bulletin to thirty
  // people gets read once more, by a human, before it goes.
  //
  // Everyone is addressed in BCC. A survivor pool is a small league of people
  // who mostly know each other, but publishing thirty addresses to thirty
  // inboxes is still not the admin's to do.

  // Gmail's own compose endpoint rather than a mailto:. A mailto: hands the
  // bulletin to whatever Windows has registered as the default mail handler,
  // which on the admin's machine is Outlook; the league is run out of Gmail.
  // This URL does not care what the OS default is - it opens Gmail on the web,
  // in whichever account the browser is already signed into.
  const GMAIL_COMPOSE = 'https://mail.google.com/mail/?view=cm&fs=1';

  // Browsers and Gmail both stop reading a URL somewhere, and a truncated BCC
  // line silently drops recipients. At league size the list is nowhere near
  // this; the check is here so that if it ever is, the page says so instead of
  // quietly mailing half the league.
  const APB_URL_LIMIT = 7000;

  function apbAddress(row) {
    // The profile copy is the one the league is reached at; login_email is the
    // fallback for a record where the two have drifted.
    return String(row.email || row.login_email || '').trim();
  }

  // Their run is over, so there is no pick to chase. Same free-text match the
  // rest of the site makes on result.
  function apbEliminated(row) {
    return /dun\s*dun/i.test(String(row.game_status || ''));
  }

  // Two halves of the same question: who has named a victim this week and who
  // has not. Eliminated suspects are in neither, because their season is over
  // and neither bulletin is addressed to them.
  function apbRecipients(kind) {
    const live = recordRows.filter((row) => apbAddress(row) && !apbEliminated(row));
    return kind === 'named'
      ? live.filter((row) => row.week_pick)
      : live.filter((row) => !row.week_pick);
  }

  // Small numbers read better spelled out in running prose. Past twelve this
  // falls back to the digit rather than inventing words for it.
  const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six',
    'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  const spellNumber = (n) => NUMBER_WORDS[n] || String(n);

  // A URL that reads as itself. Written this way so the HTML copy is clickable
  // and the plain-text fallback still shows the whole address rather than a
  // bare word with the link lost.
  const apbLink = (url) => '<a href="' + url + '">' + url + '</a>';

  // The bulletin each group gets, as a starting point. It lands in the fields
  // below the cards rather than going straight to Gmail, so it can be read and
  // changed first.
  //
  // Paragraphs of HTML, not a block of text: the message is pasted into Gmail,
  // and pasting rich text is what keeps the links clickable and the paragraphs
  // apart. Plain ASCII inside them all the same - this goes out to thirty
  // different mail clients, and the ones that mangle a character mangle it in
  // someone else's inbox where nobody here will see it.
  function apbDraft(kind) {
    const week = Number(window.CURRENT_WEEK) || 0;

    // The tally the bulletin quotes. Everyone still in the game counts, whether
    // or not they have an email on file - "14 out of 30 picks are in" is a fact
    // about the league, not about who this particular bulletin reaches.
    // Eliminated suspects are out of both halves: they cannot pick, so counting
    // them would make the league look permanently behind.
    const live = recordRows.filter((row) => !apbEliminated(row));
    const picksIn = live.filter((row) => row.week_pick).length;

    // The house rule, read from js/season.js rather than typed in, so the
    // number in the email cannot drift from the one the site enforces.
    const lockMinutes = Number(window.PICK_LOCK_MINUTES) || 5;

    const subject = "(Fantasy Football) Week " + week +
      " All Points Bulletin: Law & Order: Special Victory Unit";

    // Week 1 only, and first, on both bulletins. The league is still open until
    // the last kickoff of the opening week, and that is the one week where the
    // most useful thing a member can do is bring somebody else in. From Week 2
    // the door is shut and the paragraph would be a lie, so it does not appear.
    const recruiting = week === 1
      ? ["It's not too late to get your friends to play! They have until " +
         spellNumber(lockMinutes) + " minutes before kickoff of the LAST game of week " + week +
         ". Of course they will only have two teams to choose from if they wait that " +
         "late, so sooner is better. Finger fellow suspects here: " +
         apbLink('https://thegamebureau.com/ff')]
      : [];

    const rules = "You can make your picks for the whole season right now and change " +
      "them week by week if you'd like.";

    const tally = "As of this email, " + picksIn + " out of " + live.length +
      " picks are in. ";

    if (kind === 'named') {
      return {
        subject: subject,
        paragraphs: recruiting.concat([
          "Your victim for Week " + week + " is named and on the record. You can change " +
            "your choice up to " + lockMinutes + " minutes before your current victim's " +
            "game kicks off. You can only change it to a team that has not kicked off. " +
            "Visit " + apbLink('https://thegamebureau.com/ff/law/index.html') +
            " for all of the rules.",
          rules,
          tally + "See live league info here: " +
            apbLink('https://thegamebureau.com/ff/reports/index.html')
        ])
      };
    }

    return {
      subject: subject,
      paragraphs: recruiting.concat([
        "You have not named a victim for Week " + week + ". Name a team you expect to " +
          "lose, before their game kicks off. Miss it and the case closes on you. You " +
          "can change your choice up to " + lockMinutes + " minutes before your current " +
          "victim's game kicks off. You can only change it to a team that has not kicked " +
          "off. Visit " + apbLink('https://thegamebureau.com/ff/law/index.html') +
          " for all of the rules.",
        rules,
        tally + "Name yours here: " +
          apbLink('https://thegamebureau.com/ff/victims/index.html?week=' + week)
      ])
    };
  }

  function drawUpApb(kind) {
    const rows = apbRecipients(kind);
    if (!rows.length) {
      setApbStatus('Nobody to send to.', 'note');
      return;
    }

    const draft = apbDraft(kind);
    apbKind = kind;
    els.apbSubject.value = draft.subject;
    // contenteditable, so the admin can still change the wording, and still
    // rich text when it is copied out.
    els.apbBody.innerHTML = draft.paragraphs.map((p) => '<p>' + p + '</p>').join('');
    els.apbSend.disabled = false;
    els.apbCopyMessage.disabled = false;

    els.apbDraftNote.textContent =
      rows.length + ' recipient' + (rows.length === 1 ? '' : 's') +
      ', all in BCC. Edit it, then open it in Gmail.';

    setApbStatus('Bulletin drawn up. Nothing is sent until you send it.', 'good');
    els.apbSubject.focus();
  }

  // The message as rich text and as plain text, so a paste keeps the links and
  // the paragraphs, and anything that cannot take HTML still gets something
  // readable.
  function apbClipboardFlavours() {
    const html = '<div>' + els.apbBody.innerHTML + '</div>';

    // Built from the paragraphs rather than from innerText. innerText is
    // layout-driven and returns nothing at all while the APB panel is
    // collapsed, which would put an empty plain-text flavour on the clipboard
    // for anything that cannot take the HTML one.
    const blocks = [...els.apbBody.querySelectorAll('p')]
      .map((p) => p.textContent.trim())
      .filter(Boolean);

    const text = blocks.length
      ? blocks.join('\n\n')
      : els.apbBody.textContent.trim();
    return { html: html, text: text };
  }

  async function copyApbMessage() {
    const flavours = apbClipboardFlavours();
    if (!flavours.text) return false;

    // The rich path. Needs a secure context, which rules out plain http on
    // anything but localhost.
    if (window.ClipboardItem && navigator.clipboard?.write) {
      try {
        await navigator.clipboard.write([
          new window.ClipboardItem({
            'text/html': new Blob([flavours.html], { type: 'text/html' }),
            'text/plain': new Blob([flavours.text], { type: 'text/plain' })
          })
        ]);
        return true;
      } catch (error) {
        // Fall through and try the old way rather than giving up.
      }
    }

    // execCommand on a selection of live nodes carries the formatting with it,
    // which writeText would not.
    const scratch = document.createElement('div');
    scratch.innerHTML = flavours.html;
    scratch.setAttribute('contenteditable', 'true');
    scratch.style.position = 'fixed';
    scratch.style.opacity = '0';
    document.body.appendChild(scratch);

    const range = document.createRange();
    range.selectNodeContents(scratch);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    let copied = true;
    try {
      document.execCommand('copy');
    } catch (error) {
      copied = false;
    }

    selection.removeAllRanges();
    scratch.remove();
    return copied;
  }

  async function copyApbMessageClicked(button) {
    const copied = await copyApbMessage();
    if (!copied) {
      setApbStatus('Copy failed. Select the message and copy it by hand.', 'bad');
      return;
    }

    const original = button.textContent;
    button.textContent = 'Copied';
    window.setTimeout(function () { button.textContent = original; }, 1200);
    setApbStatus('Message copied with its formatting. Paste it into Gmail.', 'good');
  }

  async function openApbMail() {
    if (!apbKind) return;

    const rows = apbRecipients(apbKind);
    if (!rows.length) {
      setApbStatus('Nobody to send to any more. Reload Records and try again.', 'bad');
      return;
    }

    const bcc = rows.map(apbAddress).join(',');

    // Deliberately no &body. Gmail's compose URL only takes plain text, so
    // filling it would put an unformatted copy in the window that the paste
    // then duplicates. The message goes on the clipboard instead and lands in
    // the compose window with its links and paragraphs intact.
    const copied = await copyApbMessage();

    // The admin is the To: line - a compose window wants one, and every actual
    // recipient is in BCC. It also means the sender keeps a copy.
    const href = GMAIL_COMPOSE +
      '&to=' + encodeURIComponent(adminEmail) +
      '&bcc=' + encodeURIComponent(bcc) +
      '&su=' + encodeURIComponent(els.apbSubject.value);

    if (href.length > APB_URL_LIMIT) {
      setApbStatus(
        rows.length + ' addresses make a ' + href.length + '-character link, long ' +
        'enough that it may get cut short. Check the BCC line in Gmail before sending.',
        'bad'
      );
    } else if (copied) {
      setApbStatus('Gmail opened for ' + rows.length + ' recipient' +
        (rows.length === 1 ? '' : 's') + ', all in BCC. The message is on your ' +
        'clipboard - paste it into the compose window.', 'good');
    } else {
      setApbStatus('Gmail opened, but the message could not be copied. Use Copy ' +
        'Message, or copy it out of the draft by hand.', 'bad');
    }

    // A new tab, not this one: an http link in window.location would navigate
    // the admin page away and lose the draft that was just edited.
    window.open(href, '_blank', 'noopener');
  }

  function renderApb() {
    const week = Number(window.CURRENT_WEEK) || 0;

    if (els.apbAllTitle) {
      els.apbAllTitle.textContent = week ? 'Victim Named - Week ' + week : 'Victim Named';
    }
    if (els.apbNoPickTitle) {
      els.apbNoPickTitle.textContent = week ? 'No Victim Named - Week ' + week : 'No Victim Named';
    }

    const named = apbRecipients('named');
    const noPick = apbRecipients('nopick');

    apbFill(els.apbAllCount, els.apbAllNames, named, 'nobody has named a victim yet');
    apbFill(els.apbNoPickCount, els.apbNoPickNames, noPick, 'everyone still in has named one');

    const pairs = [
      [els.apbAllEmail, named], [els.apbAllCopy, named],
      [els.apbNoPickEmail, noPick], [els.apbNoPickCopy, noPick]
    ];
    for (const pair of pairs) {
      if (pair[0]) pair[0].disabled = !pair[1].length;
    }

    // A group that has emptied out since the draft was written should not still
    // have a live send button pointed at it.
    if (apbKind && !apbRecipients(apbKind).length) {
      if (els.apbSend) els.apbSend.disabled = true;
      if (els.apbCopyMessage) els.apbCopyMessage.disabled = true;
    }

    // What the two counts do not show: who could not be reached at all, and who
    // is out of the game and so in neither bulletin.
    const eliminated = recordRows.filter(apbEliminated).length;
    const unreachable = recordRows.filter((row) => !apbAddress(row)).length;

    if (!recordRows.length) {
      setApbStatus('No roster loaded.', 'note');
      return;
    }

    const notes = [recordRows.length + ' on the roster.'];
    if (eliminated) notes.push(eliminated + ' eliminated, in neither bulletin.');
    if (unreachable) notes.push(unreachable + ' with no email on file, unreachable.');
    setApbStatus(notes.join(' '), unreachable ? 'note' : 'good');
  }

  // Who is on the list, spelled out: the handle, the address it is going to,
  // and the team they named. A run of usernames was enough to count heads but
  // not to check the list before sending it - the address is the thing that
  // actually receives the bulletin, and the team is what the message is about.
  //
  // The no-pick card leaves the team column empty, which is the whole reason
  // that card exists.
  function apbFill(countEl, namesEl, rows, emptyLabel) {
    if (countEl) {
      countEl.textContent = rows.length + ' recipient' + (rows.length === 1 ? '' : 's');
    }

    if (!namesEl) return;

    if (!rows.length) {
      namesEl.innerHTML = '<li class="apb-name-empty">Nobody - ' +
        escapeAdminHtml(emptyLabel) + '.</li>';
      return;
    }

    namesEl.innerHTML = rows.map((row) => {
      // A real name if there is one, because the admin panel is the one place
      // the league's actual names live.
      const real = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
      return '<li class="apb-name-row">' +
        '<b>' + escapeAdminHtml(row.username || '(no handle)') +
          (real ? ' <span class="apb-name-real">' + escapeAdminHtml(real) + '</span>' : '') + '</b>' +
        '<span class="apb-name-email">' + escapeAdminHtml(apbAddress(row)) + '</span>' +
        '<span class="apb-name-team">' + escapeAdminHtml(row.week_pick || '') + '</span>' +
        '</li>';
    }).join('');
  }

  async function copyApbAddresses(kind, button) {
    const rows = apbRecipients(kind);
    if (!rows.length || !button) return;

    const copied = await copyToClipboard(rows.map(apbAddress).join(', '));

    if (!copied) {
      setApbStatus('Copy failed. Select the addresses by hand.', 'bad');
      return;
    }

    const original = button.textContent;
    button.textContent = 'Copied';
    window.setTimeout(function () { button.textContent = original; }, 1200);
    setApbStatus(rows.length + ' address' + (rows.length === 1 ? '' : 'es') + ' on the clipboard.', 'good');
  }

  function setApbStatus(message, kind) {
    window.ffToast?.(message, kind, 'apb');
  }

  // ===== 2025 COLD CASES =====
  // A closed season, so this is a record rather than a tool: nothing here can
  // be edited and the project that served it no longer exists.
  //
  // It comes from the database, not from 2025/data/profiles.json, even though
  // that file is right there. The names and addresses used to live in it, and a
  // file under the served root is public no matter which page fetches it -
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
  // The 2025 winner. Their message says so instead of counting weeks - telling
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
  // literal newline, but only by the letter of the spec - encoding it is one
  // character and removes the doubt.
  function attrText(value) {
    return escapeAdminHtml(value).replace(/\n/g, '&#10;');
  }

  // Shared by the invite buttons and the APB. Returns whether it worked, so
  // each caller can report it wherever makes sense for that panel.
  async function copyToClipboard(text) {
    if (!text) return false;

    try {
      await navigator.clipboard.writeText(text);
      return true;
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

      let copied = true;
      try {
        document.execCommand('copy');
      } catch (fallbackError) {
        copied = false;
      }

      scratch.remove();
      return copied;
    }
  }

  async function copyInvite(button) {
    const text = button.dataset.copyInvite || '';
    if (!text) return;

    if (!(await copyToClipboard(text))) {
      setArchiveStatus('Copy failed. Select the text by hand.', 'bad');
      return;
    }

    // On the button itself, because a status line at the top of a 32-row table
    // is nowhere near the thing that was clicked.
    const original = button.textContent;
    button.textContent = 'Copied';
    window.setTimeout(() => { button.textContent = original; }, 1200);
  }

  function setArchiveStatus(message, kind) {
    window.ffToast?.(message, kind, 'archive');
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

  function setAdminStatus(message, kind) {
    window.ffToast?.(message, kind, 'gate');
  }

  function hideTools() {
    if (els.databasePanel) {
      els.databasePanel.hidden = true;
    }
    if (els.recordsPanel) {
      els.recordsPanel.hidden = true;
    }
    if (els.schedulePanel) {
      els.schedulePanel.hidden = true;
    }
    if (els.apbPanel) {
      els.apbPanel.hidden = true;
    }
    if (els.archivePanel) {
      els.archivePanel.hidden = true;
    }
    closeDeleteModal();
    closeMugshotEditor();
  }

})();
