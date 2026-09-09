// ===== RAP SHEET =====
// Everything the league holds on a suspect, editable by that suspect and
// nobody else.
//
// WHAT IT REPLACES
// js/mugshot-edit.js, which offered one control - REPHOTOGRAPH - because the
// photograph was the one field the database let a member change. Everything
// else, a misspelt first name included, had to go through the admin screen.
// supabase/sql/ff_own_rap_sheet.sql opens the rest of the row through a pair of
// SECURITY DEFINER functions, and this is the form in front of them.
//
// WHY THE READ IS AN RPC AND NOT A SELECT
// last_name, sms and email are not selectable by a browser role at all, on
// purpose: column privileges are role-wide, so granting a member the right to
// read their own surname grants them everybody's. _2026_my_rap_sheet returns
// the caller's row and only the caller's, which is narrower than any grant can
// be.
//
// THE EMAIL FIELD IS THE ODD ONE
// It is the login, so it belongs to Supabase auth rather than to this table.
// Changing it sends a confirmation link and the account moves when that link is
// clicked, which is why it is saved separately from everything else and says so.
(function () {
  const RAP_CONFIG = window.FF_SUPABASE_CONFIG || {};
  const RAP_URL = RAP_CONFIG.url || 'https://vkoczgzizzppdrpvpemh.supabase.co';
  const RAP_KEY = RAP_CONFIG.publishableKey || 'sb_publishable_XfvD3zCvnCHT1v_EGE-LJA_3Z9bGjKw';
  const RAP_STORAGE_KEY = RAP_CONFIG.storageKey || 'law-order-svu-auth-vkoczgzizzppdrpvpemh';
  const READ_RPC = RAP_CONFIG.rpcs?.myRapSheet || '_2026_my_rap_sheet';
  const SAVE_RPC = RAP_CONFIG.rpcs?.saveMyRapSheet || '_2026_save_my_rap_sheet';

  const MAX_BYTES = 5 * 1024 * 1024;
  // The same 256px JPEG the booking form stores, so a replacement weighs what
  // the original did. Every stored mugshot is fetched again for every player in
  // the lineup, so the saving is per row, per visitor.
  const STORAGE_SIZE = 256;
  const JPEG_QUALITY = 0.88;
  const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;

  // What was on file when the form opened. Anything unchanged is sent as null,
  // which the function reads as "leave this alone" - so two people editing
  // different fields cannot overwrite each other's work with stale values.
  let loaded = null;
  let photo = null;
  let busy = false;
  let picker = null;

  // The session client js/auth-corner.js publishes. Shared rather than rebuilt:
  // a second GoTrue instance on the same storage key races the first for the
  // one-time token a recovery or confirmation link carries.
  //
  // This used to be a ladder over window.db / window.joinDb and so on, which
  // never matched anything - those are top-level `const`s, which are global
  // bindings but NOT window properties - so it fell through to createClient
  // every time and did the exact thing the comment said it was avoiding.
  const rapDb = (function () {
    if (window.ffAuthClient?.auth) return window.ffAuthClient;
    if (!window.supabase) return null;
    return window.supabase.createClient(RAP_URL, RAP_KEY, {
      auth: {
        persistSession: true,
        // The URL is auth-corner's to read. This branch only runs when that file
        // is absent, and a page with no auth module has no recovery link to
        // land on either.
        detectSessionInUrl: false,
        storageKey: RAP_STORAGE_KEY,
        storage: window.localStorage,
      },
    });
  })();

  document.addEventListener('DOMContentLoaded', () => {
    // Delegated: the lineup redraws on every auth change, and the button lives
    // inside a lightbox that is built on demand.
    document.addEventListener('click', (event) => {
      if (!event.target.closest('[data-rap-sheet]')) return;
      event.preventDefault();
      openRapSheet();
    });
  });

  function toast(message, kind) {
    if (window.ffToast) window.ffToast(message, kind, 'rap-sheet');
    else if (kind === 'bad') window.alert(message);
  }

  function setStatus(message, kind) {
    const el = document.getElementById('rapSheetStatus');
    if (!el) return;
    el.textContent = message || '';
    el.classList.remove('rap-sheet-status-bad', 'rap-sheet-status-good');
    if (kind) el.classList.add('rap-sheet-status-' + kind);
  }

  function buildRapSheet() {
    if (document.getElementById('rapSheetModal')) return;

    const modal = document.createElement('div');
    modal.id = 'rapSheetModal';
    modal.className = 'modal-backdrop';
    modal.hidden = true;
    modal.innerHTML = [
      '<div class="modal-card rap-sheet-card" role="dialog" aria-modal="true" aria-labelledby="rapSheetTitle">',
      '  <button class="modal-close" id="btnCloseRapSheet" type="button" aria-label="Close">&times;</button>',
      '  <h2 id="rapSheetTitle">Rap Sheet</h2>',
      '  <form class="join-form rap-sheet-form" id="rapSheetForm" novalidate>',

      '    <div class="join-field avatar-field">',
      '      <label for="rapSheetPhoto">Mugshot <span class="privacy-tag privacy-tag-public">Public</span></label>',
      '      <div class="avatar-upload-row">',
      '        <div class="avatar-preview-frame rap-sheet-frame" id="rapSheetFrame">',
      '          <img class="rap-sheet-preview" id="rapSheetPreview" alt="Your mugshot" width="96" height="96"/>',
      '        </div>',
      '        <div class="avatar-upload-control">',
      '          <button class="btn btn-secondary btn-mini" id="rapSheetPhoto" type="button">Replace Photo</button>',
      '          <div class="avatar-status" id="rapSheetPhotoStatus" aria-live="polite"></div>',
      '        </div>',
      '      </div>',
      '    </div>',

      '    <div class="join-field">',
      '      <label for="rapSheetUsername">Username / Team Name <span class="privacy-tag privacy-tag-public">Public</span></label>',
      '      <input id="rapSheetUsername" name="username" type="text" autocomplete="nickname" maxlength="20" />',
      '      <p class="gate-help">3-20 characters. Letters, numbers and underscores only. Change it and',
      '         every board on the site follows, including picks you have already filed.</p>',
      '    </div>',

      '    <div class="join-field">',
      '      <label for="rapSheetFirstName">First Name <span class="privacy-tag privacy-tag-players">Seen by Players Only</span></label>',
      '      <input id="rapSheetFirstName" name="first_name" type="text" autocomplete="given-name" />',
      '    </div>',

      '    <div class="join-field">',
      '      <label for="rapSheetLastName">Last Name <span class="privacy-tag">Private</span></label>',
      '      <input id="rapSheetLastName" name="last_name" type="text" autocomplete="family-name" />',
      '    </div>',

      '    <div class="join-field">',
      '      <label for="rapSheetSms">Phone <span class="privacy-tag">Private</span></label>',
      '      <input id="rapSheetSms" name="tel" type="tel" autocomplete="tel" />',
      '      <p class="gate-help">Only used to chase you for a pick. Leave it blank if you would rather not.</p>',
      '    </div>',

      '    <div class="join-field">',
      '      <label>Placard Colours <span class="privacy-tag privacy-tag-public">Public</span></label>',
      '      <div class="rap-sheet-colours">',
      '        <label class="rap-sheet-swatch"><span>Primary</span>',
      '          <input id="rapSheetPrimary" type="color" aria-label="Primary colour" /></label>',
      '        <label class="rap-sheet-swatch"><span>Secondary</span>',
      '          <input id="rapSheetSecondary" type="color" aria-label="Secondary colour" /></label>',
      '        <button class="btn btn-secondary btn-mini" id="rapSheetSample" type="button">Use My Photo</button>',
      '      </div>',
      '      <p class="gate-help">The stripe down your mugshot everywhere it appears. Use My Photo',
      '         clears them and lets the site pick the two colours out of the picture again.</p>',
      '    </div>',

      '    <div class="join-field">',
      '      <label for="rapSheetEmail">Email <span class="privacy-tag">Private</span></label>',
      '      <input id="rapSheetEmail" name="email" type="email" autocomplete="email" />',
      '      <p class="gate-help">This is how you sign in. Changing it sends a confirmation link to the',
      '         new address, and the change only takes once you have clicked it.</p>',
      '    </div>',

      '    <div class="action-buttons">',
      '      <button class="btn btn-primary" id="btnSaveRapSheet" type="submit">Save Rap Sheet</button>',
      '    </div>',

      '    <div id="rapSheetStatus" class="join-status" role="status" aria-live="polite"></div>',
      '  </form>',
      '</div>'
    ].join('');

    document.body.appendChild(modal);

    document.getElementById('btnCloseRapSheet').addEventListener('click', closeRapSheet);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeRapSheet();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.hidden) closeRapSheet();
    });

    document.getElementById('rapSheetForm').addEventListener('submit', (event) => {
      event.preventDefault();
      save();
    });

    document.getElementById('rapSheetPhoto').addEventListener('click', pickPhoto);

    document.getElementById('rapSheetSample').addEventListener('click', () => {
      coloursCleared = true;
      coloursTouched = false;
      showColours(null);
      setStatus('Colours cleared. Save to let the site read them off your photo again.', '');
    });

    for (const id of ['rapSheetPrimary', 'rapSheetSecondary']) {
      document.getElementById(id).addEventListener('input', () => {
        coloursTouched = true;
        coloursCleared = false;
        paintStripe();
      });
    }
  }

  // Three states, not two, because a colour input has no empty value. Untouched
  // sends null and the pair on file is left alone; touched sends the swatches;
  // cleared sends empty strings, which is what hands the choice back to the
  // sampler in js/suspect-colors.js.
  //
  // Without the untouched state, opening the form and saving would write the
  // swatch values back - and since a colour input lower-cases its hex, that
  // alone counted as a change and stamped a house-default override onto anyone
  // who had never picked a colour at all.
  let coloursTouched = false;
  let coloursCleared = false;

  function showColours(pair) {
    document.getElementById('rapSheetPrimary').value = pair?.[0] || '#1A1A1A';
    document.getElementById('rapSheetSecondary').value = pair?.[1] || '#F2C200';
    paintStripe();
  }

  function paintStripe() {
    const frame = document.getElementById('rapSheetFrame');
    frame.style.setProperty('--stripe-a', document.getElementById('rapSheetPrimary').value);
    frame.style.setProperty('--stripe-b', document.getElementById('rapSheetSecondary').value);
  }

  async function openRapSheet() {
    if (!rapDb) {
      toast('Records room is offline. Refresh and try again.', 'bad');
      return;
    }

    buildRapSheet();
    setStatus('');
    document.getElementById('rapSheetPhotoStatus').textContent = '';
    photo = null;

    const { data, error } = await rapDb.rpc(READ_RPC);

    if (error) {
      const missing = error.code === 'PGRST202' ||
        /could not find the function|does not exist/i.test(error.message || '');
      toast(missing
        ? 'Rap sheets are not switched on yet: run supabase/sql/ff_own_rap_sheet.sql.'
        : 'Could not open your rap sheet: ' + error.message, 'bad');
      return;
    }

    // The function returns a table, so one row or none.
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      toast('You have no record to edit yet.', 'bad');
      return;
    }

    loaded = row;
    coloursTouched = false;
    coloursCleared = false;
    document.getElementById('rapSheetUsername').value = row.username || '';
    document.getElementById('rapSheetFirstName').value = row.first_name || '';
    document.getElementById('rapSheetLastName').value = row.last_name || '';
    document.getElementById('rapSheetSms').value = row.sms || '';
    document.getElementById('rapSheetEmail').value = row.email || '';
    document.getElementById('rapSheetPreview').src = row.avatar_data_url || defaultMugshot();
    showColours(row.color_primary && row.color_secondary
      ? [row.color_primary, row.color_secondary]
      : null);

    document.getElementById('rapSheetModal').hidden = false;
    document.getElementById('rapSheetUsername').focus();
  }

  function closeRapSheet() {
    const modal = document.getElementById('rapSheetModal');
    if (modal) modal.hidden = true;
  }

  function defaultMugshot() {
    const prefix = document.getElementById('siteNav')?.dataset.prefix || '';
    return new URL(prefix + 'src/generated/mugshot-placeholder.svg', window.location.href).href;
  }

  function pickPhoto() {
    if (busy) return;

    if (!picker) {
      picker = document.createElement('input');
      picker.type = 'file';
      picker.accept = 'image/*';
      picker.style.display = 'none';
      picker.addEventListener('change', async () => {
        const file = picker.files?.[0];
        // Cleared so choosing the same file twice still fires a change event,
        // which a retry after a failed read is.
        picker.value = '';
        if (!file) return;

        const status = document.getElementById('rapSheetPhotoStatus');
        try {
          validatePhoto(file);
          status.textContent = 'Sizing mugshot...';
          photo = await fileToMugshotDataUrl(file);
          document.getElementById('rapSheetPreview').src = photo;
          status.textContent = 'New mugshot ready. Save to keep it.';
        } catch (error) {
          photo = null;
          status.textContent = error?.message || 'That image could not be read.';
        }
      });
      document.body.appendChild(picker);
    }

    picker.click();
  }

  function validatePhoto(file) {
    if (!file.type || !file.type.startsWith('image/')) {
      throw new Error('Mugshot must be an image file.');
    }
    if (file.size > MAX_BYTES) {
      throw new Error('Mugshot image must be 5 MB or smaller.');
    }
  }

  // Centre-cropped square, flattened onto white so a transparent PNG does not
  // come out as a black tile on the placard.
  function fileToMugshotDataUrl(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();

      image.onload = () => {
        URL.revokeObjectURL(url);

        const sourceWidth = image.naturalWidth || image.width;
        const sourceHeight = image.naturalHeight || image.height;
        const cropSize = Math.min(sourceWidth, sourceHeight);
        const cropX = Math.floor((sourceWidth - cropSize) / 2);
        const cropY = Math.floor((sourceHeight - cropSize) / 2);

        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = STORAGE_SIZE;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, STORAGE_SIZE, STORAGE_SIZE);
        ctx.drawImage(image, cropX, cropY, cropSize, cropSize, 0, 0, STORAGE_SIZE, STORAGE_SIZE);

        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      };

      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Mugshot image could not be read.'));
      };

      image.src = url;
    });
  }

  // null for anything the suspect did not touch, so the function leaves it be.
  function changed(value, before) {
    const next = String(value == null ? '' : value).trim();
    const prev = String(before == null ? '' : before).trim();
    return next === prev ? null : next;
  }

  async function save() {
    if (busy) return;

    const username = document.getElementById('rapSheetUsername').value.trim();
    if (!USERNAME_PATTERN.test(username)) {
      setStatus('Username must be 3 to 20 letters, numbers or underscores.', 'bad');
      document.getElementById('rapSheetUsername').focus();
      return;
    }

    const email = document.getElementById('rapSheetEmail').value.trim();
    const emailChanged = email.toLowerCase() !== String(loaded.email || '').toLowerCase();
    if (emailChanged && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus('That is not a complete email address.', 'bad');
      document.getElementById('rapSheetEmail').focus();
      return;
    }

    busy = true;
    const button = document.getElementById('btnSaveRapSheet');
    button.disabled = true;
    setStatus('Filing...', '');

    try {
      let colourPair = [null, null];
      if (coloursCleared) colourPair = ['', ''];
      else if (coloursTouched) {
        colourPair = [
          document.getElementById('rapSheetPrimary').value,
          document.getElementById('rapSheetSecondary').value
        ];
      }

      const { error } = await rapDb.rpc(SAVE_RPC, {
        new_username: changed(username, loaded.username),
        new_first_name: changed(document.getElementById('rapSheetFirstName').value, loaded.first_name),
        new_last_name: changed(document.getElementById('rapSheetLastName').value, loaded.last_name),
        new_sms: changed(document.getElementById('rapSheetSms').value, loaded.sms),
        new_avatar_data_url: photo,
        new_color_primary: colourPair[0],
        new_color_secondary: colourPair[1],
      });

      if (error) {
        setStatus(saveErrorMessage(error), 'bad');
        return;
      }

      // Deliberately last, and deliberately separate: it is a change to the
      // login rather than to this row, it cannot be undone by the same button,
      // and it does not take until a link in an inbox is clicked.
      if (emailChanged) {
        const { error: emailError } = await rapDb.auth.updateUser({ email });
        if (emailError) {
          setStatus('Everything else saved. The email could not be changed: ' +
            emailError.message, 'bad');
          announce();
          return;
        }
        toast('Rap sheet filed. Check ' + email + ' for the link that moves your login.', 'good');
      } else {
        toast('Rap sheet filed.', 'good');
      }

      closeRapSheet();
      announce();
    } catch (error) {
      setStatus(error?.message || 'That could not be filed.', 'bad');
    } finally {
      busy = false;
      button.disabled = false;
    }
  }

  function saveErrorMessage(error) {
    if (error?.code === '23505') return 'That username is already booked. Try another handle.';
    if (error?.code === '22023') return error.message;
    if (error?.code === '42501') return 'You have been signed out. Sign in again and try that once more.';
    return 'Could not file that: ' + (error?.message || 'unknown error');
  }

  // Repaint whatever is on screen. The suspects page redraws its own lineup;
  // everything else listens for the auth event, which is the signal a name or a
  // photograph may have moved.
  function announce() {
    if (typeof window.loadCurrentSuspects === 'function') window.loadCurrentSuspects();
    window.ffRefreshAuthCorner?.();
    window.dispatchEvent(new CustomEvent('ff-auth-changed', { detail: { user: null, profile: null } }));
  }
})();
