// ===== COLOUR LAB =====
// Admin tool for choosing a suspect's two-tone theme by eye.
//
// Normally those colours are sampled from the mugshot at render time by
// dominantPair() — one copy in js/suspect-lineup-chart.js for the Suspect
// Tracker, one in js/suspects.js for the lineup placards. Sampling takes
// whichever colour covers the most pixels, which in a photo shot against a dark
// room or a grey wall is the background rather than the person. Those suspects
// come out grey-on-grey, and no amount of tuning fixes them without re-colouring
// the 30 that already look right.
//
// So this page shows what the sampler picked, lets you pick a better pair off
// the photograph itself, and prints the map to paste into
// js/suspect-colors.js. It writes nothing: the output is source code for a
// human to commit, which is the point — the overrides belong in the repo, not
// in a table the site has to read at load.
(function () {
  const CONFIG = window.FF_SUPABASE_CONFIG || {};
  const PROFILES_TABLE = CONFIG.tables?.profiles || 'ff_profiles';
  const ALLOWED_USERNAME = 'theclarinetofjustice';
  const STORE = 'ff-colour-lab-overrides';

  // Matches the samplers exactly. Any drift here and the page would be
  // reporting colours the site does not actually use.
  const SAMPLE = 24;
  const MIN_DISTANCE = 60;

  const SHOT = 168;      // on-screen size of the pickable mugshot
  const LOUPE_PX = 84;   // on-screen size of the magnifier
  const LOUPE_SRC = 12;  // how many source pixels the magnifier covers

  const labDb = window.supabase?.createClient(CONFIG.url, CONFIG.publishableKey, {
    auth: {
      persistSession: true,
      storageKey: CONFIG.storageKey || 'law-order-svu-auth',
      storage: window.localStorage
    }
  });

  const sampled = new Map();   // username -> [primary, secondary] as first found
  let edits = {};
  let armed = null;            // { username, slot }
  const els = {};

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('labGrid')) return;

    els.status = document.getElementById('labStatus');
    els.tools = document.getElementById('labTools');
    els.grid = document.getElementById('labGrid');
    els.hint = document.getElementById('labHint');
    els.count = document.getElementById('labCount');
    els.out = document.getElementById('labOut');

    try { edits = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { edits = {}; }

    document.getElementById('btnLabCopy')?.addEventListener('click', copyOut);
    document.getElementById('btnLabReset')?.addEventListener('click', resetAll);
    els.grid.addEventListener('click', onGridClick);
    els.grid.addEventListener('mousemove', onGridMove);
    els.grid.addEventListener('mouseout', onGridOut);
    els.grid.addEventListener('input', onPickerInput);

    gate();
  });

  // ===== ACCESS =====
  // Same gate as js/admin.js. This page reads every member's mugshot, so it is
  // held to the same standard as the rest of the admin room.
  async function gate() {
    if (!labDb) {
      setStatus('Colour lab is offline. Refresh and try again.', 'bad');
      return;
    }

    setStatus('Checking credentials.', 'note');

    const { data: { user }, error: userError } = await labDb.auth.getUser();
    if (userError || !user) {
      setStatus('The colour lab requires TheClarinetOfJustice to be checked in.', 'bad');
      return;
    }

    const { data: profile, error: profileError } = await labDb
      .from(PROFILES_TABLE)
      .select('username')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) {
      setStatus(`Profile check failed: ${profileError.message}`, 'bad');
      return;
    }

    const username = String(profile?.username || user.user_metadata?.username || '')
      .trim().toLowerCase();

    if (username !== ALLOWED_USERNAME) {
      setStatus('Access denied. This room is reserved for TheClarinetOfJustice.', 'bad');
      return;
    }

    els.tools.hidden = false;
    await loadSuspects();
  }

  // ===== THE SAMPLER =====
  // A copy of dominantPair() that keeps every bucket rather than returning two,
  // so the page can report what share of the frame each colour took.
  function buckets(img) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SAMPLE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
    const px = ctx.getImageData(0, 0, SAMPLE, SAMPLE).data;

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

  const distance = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
  const toHex = (c) => '#' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  const toRgb = (h) => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) });
  const saturation = (c) => { const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b); return mx ? (mx - mn) / mx : 0; };

  function inkFor(hex) {
    const c = toRgb(hex);
    return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255 > 0.58 ? '#0D0D0D' : '#FFFFFF';
  }

  // ===== RENDER =====
  async function loadSuspects() {
    setStatus('Loading mugshots.', 'note');

    const { data, error } = await labDb
      .from(PROFILES_TABLE)
      .select('id, username, avatar_data_url')
      .order('username');

    if (error) {
      setStatus(`Mugshot fetch failed: ${error.message}`, 'bad');
      return;
    }

    const rows = (data || []).filter(row => row.username);
    let pickable = 0;

    for (const row of rows) {
      if (!row.avatar_data_url) {
        els.grid.insertAdjacentHTML('beforeend', emptyCardHtml(row.username));
        continue;
      }

      const img = new Image();
      img.src = row.avatar_data_url;
      try { await img.decode(); } catch { continue; }

      const ranked = buckets(img);
      if (!ranked.length) continue;

      const first = ranked[0];
      const second = ranked.find(c => distance(c, first) > MIN_DISTANCE) || ranked[1] || first;
      sampled.set(row.username, [toHex(first), toHex(second)]);

      els.grid.insertAdjacentHTML('beforeend', cardHtml(row, first, second));
      drawShot(cardFor(row.username).querySelector('canvas.lab-shot'), img);
      paint(row.username);
      pickable++;
    }

    renderOut();
    setStatus(`${rows.length} suspects, ${pickable} with a mugshot to pick from.`, 'good');
  }

  function emptyCardHtml(username) {
    return `
      <li class="lab-card">
        <div class="lab-shot-frame lab-shot-frame-empty"></div>
        <div class="lab-body">
          <p class="lab-name">${escapeHtml(username)}</p>
          <p class="lab-flag">No mugshot &mdash; nothing to pick from.</p>
        </div>
      </li>`;
  }

  function cardHtml(row, first, second) {
    const flags = [];
    if (distance(first, second) < MIN_DISTANCE) flags.push('Only one distinct colour in the photo &mdash; both chips came back the same.');
    if (saturation(first) < 0.18 && saturation(second) < 0.18) flags.push('Both colours are near-neutral &mdash; this card reads as grey mush.');
    if (first.share > 0.55) flags.push(`One colour is ${Math.round(first.share * 100)}% of the frame &mdash; probably the background, not the suspect.`);

    return `
      <li class="lab-card" data-username="${escapeHtml(row.username)}">
        <div class="lab-shot-wrap">
          <div class="lab-shot-frame">
            <canvas class="lab-shot" width="${SHOT}" height="${SHOT}"
                    title="Click to take this pixel"></canvas>
          </div>
          <canvas class="lab-loupe" width="${LOUPE_PX}" height="${LOUPE_PX}"></canvas>
          <p class="lab-readout"><i></i><span>Hover the mugshot</span></p>
        </div>

        <div class="lab-body">
          <p class="lab-name">${escapeHtml(row.username)}<span class="lab-edited"></span></p>

          <div class="lab-chips">
            <button class="lab-chip" data-slot="primary" data-label="Primary" type="button"></button>
            <button class="lab-chip" data-slot="secondary" data-label="Secondary" type="button"></button>
            <input class="lab-picker" type="color" aria-label="Pick any colour for the armed chip"
                   title="Pick any colour for the armed chip"/>
            <span class="lab-hexes">
              <b data-hex-for="primary"></b><br/>
              <b data-hex-for="secondary"></b>
            </span>
          </div>

          <div class="lab-preview-row">
            <span class="lab-preview lab-preview-card"><i></i>${escapeHtml(row.username)}</span>
          </div>

          ${flags.length ? `<p class="lab-flag">${flags.join('<br/>')}</p>` : ''}
        </div>
      </li>`;
  }

  const cardFor = (username) =>
    els.grid.querySelector(`.lab-card[data-username="${CSS.escape(username)}"]`);

  const pairFor = (username) => edits[username] || sampled.get(username);

  function paint(username) {
    const card = cardFor(username);
    if (!card) return;

    const [primary, secondary] = pairFor(username);
    const edited = Object.prototype.hasOwnProperty.call(edits, username);

    card.classList.toggle('is-edited', edited);
    card.querySelector('.lab-edited').textContent = edited ? 'edited' : '';
    card.querySelector('[data-slot="primary"]').style.background = primary;
    card.querySelector('[data-slot="secondary"]').style.background = secondary;
    card.querySelector('[data-hex-for="primary"]').textContent = primary;
    card.querySelector('[data-hex-for="secondary"]').textContent = secondary;
    card.querySelector('.lab-picker').value = primary;

    // The placard stripe, drawn exactly as suspects/ draws it: 9px of primary
    // then 5px of secondary down the left edge of the mugshot. Seeing it on the
    // photo itself is the whole point — a pair that looks fine as two chips can
    // disappear against the picture it is meant to frame.
    const frame = card.querySelector('.lab-shot-frame');
    frame.style.setProperty('--stripe-a', primary);
    frame.style.setProperty('--stripe-b', secondary);

    // ...and the tracker's booking card, which uses the same pair as a fill.
    const preview = card.querySelector('.lab-preview-card');
    preview.style.background = primary;
    preview.style.color = inkFor(primary);
    preview.style.borderColor = secondary;
    preview.querySelector('i').style.color = secondary;
  }

  // ===== EDITING =====
  function setSlot(username, slot, value) {
    const [primary, secondary] = pairFor(username);
    const next = slot === 'primary' ? [value, secondary] : [primary, value];
    const base = sampled.get(username);

    // Back to what the sampler picked is not an override, it is the absence of
    // one — so the entry is dropped rather than written out as a no-op.
    if (next[0] === base[0] && next[1] === base[1]) delete edits[username];
    else edits[username] = next;

    localStorage.setItem(STORE, JSON.stringify(edits));
    paint(username);
    renderOut();
  }

  function arm(username, slot) {
    els.grid.querySelectorAll('.lab-chip.is-armed').forEach(el => el.classList.remove('is-armed'));

    if (armed && armed.username === username && armed.slot === slot) {
      armed = null;
      setHint('Nothing armed.');
      return;
    }

    armed = { username, slot };
    cardFor(username).querySelector(`[data-slot="${slot}"]`).classList.add('is-armed');
    setHint(`Armed ${username} ${slot}. Now click a mugshot &mdash; any mugshot.`);
  }

  function onGridClick(event) {
    const chip = event.target.closest('.lab-chip');
    if (chip) {
      arm(chip.closest('.lab-card').dataset.username, chip.dataset.slot);
      return;
    }

    const shot = event.target.closest('canvas.lab-shot');
    if (!shot) return;

    if (!armed) {
      setHint('Arm a Primary or Secondary chip first, then click a mugshot.');
      return;
    }

    const pixel = pixelAt(shot, event);
    if (!pixel) return;

    setSlot(armed.username, armed.slot, pixel.hex);

    const from = shot.closest('.lab-card').dataset.username;
    setHint(`${armed.username} ${armed.slot} &rarr; ${pixel.hex}` +
      (from === armed.username ? '' : ` (lifted from ${from})`));
  }

  function onPickerInput(event) {
    const picker = event.target.closest('.lab-picker');
    if (!picker) return;

    const username = picker.closest('.lab-card').dataset.username;
    // The picker feeds the armed chip when it belongs to this card; otherwise
    // it is read as "set this card's primary", which is what reaching for a
    // card's own picker looks like.
    const target = armed && armed.username === username ? armed : { username, slot: 'primary' };
    setSlot(target.username, target.slot, picker.value.toUpperCase());
  }

  // ===== THE EYEDROPPER =====
  // Cover-fit and centre-cropped, the same way both pages display a mugshot, so
  // the pixel you click is a pixel the site actually shows.
  function drawShot(canvas, img) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const scale = Math.max(SHOT / img.naturalWidth, SHOT / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ctx.drawImage(img, (SHOT - w) / 2, (SHOT - h) / 2, w, h);
  }

  function pixelAt(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) * (canvas.width / rect.width));
    const y = Math.floor((event.clientY - rect.top) * (canvas.height / rect.height));
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;

    const [r, g, b] = canvas.getContext('2d', { willReadFrequently: true })
      .getImageData(x, y, 1, 1).data;
    return { x, y, hex: toHex({ r, g, b }) };
  }

  function onGridMove(event) {
    const shot = event.target.closest('canvas.lab-shot');
    if (!shot) return;

    const pixel = pixelAt(shot, event);
    if (!pixel) return;

    const wrap = shot.closest('.lab-shot-wrap');
    const loupe = wrap.querySelector('.lab-loupe');
    const ctx = loupe.getContext('2d');
    const half = Math.floor(LOUPE_SRC / 2);
    const cell = LOUPE_PX / LOUPE_SRC;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, LOUPE_PX, LOUPE_PX);
    ctx.drawImage(shot, pixel.x - half, pixel.y - half, LOUPE_SRC, LOUPE_SRC, 0, 0, LOUPE_PX, LOUPE_PX);
    ctx.strokeStyle = '#C8102E';
    ctx.lineWidth = 2;
    ctx.strokeRect(half * cell, half * cell, cell, cell);

    loupe.classList.add('is-on');
    // Sits in a corner and jumps to the opposite one as the cursor approaches,
    // so it never covers the pixel being aimed at.
    loupe.style.left = (pixel.x > SHOT / 2 ? 4 : SHOT - LOUPE_PX - 4) + 'px';
    loupe.style.top = (pixel.y > SHOT / 2 ? 4 : SHOT - LOUPE_PX - 4) + 'px';

    const readout = wrap.querySelector('.lab-readout');
    readout.querySelector('i').style.background = pixel.hex;
    readout.querySelector('span').textContent =
      pixel.hex + (armed ? ' — click to take' : ' — arm a chip first');
  }

  function onGridOut(event) {
    const shot = event.target.closest('canvas.lab-shot');
    if (!shot || shot.contains(event.relatedTarget)) return;

    const wrap = shot.closest('.lab-shot-wrap');
    wrap.querySelector('.lab-loupe').classList.remove('is-on');
    wrap.querySelector('.lab-readout i').style.background = 'transparent';
    wrap.querySelector('.lab-readout span').textContent = 'Hover the mugshot';
  }

  // ===== OUTPUT =====
  function renderOut() {
    const names = Object.keys(edits).sort();

    els.count.textContent = names.length
      ? `${names.length} suspect${names.length === 1 ? '' : 's'} edited`
      : 'No edits yet';

    els.out.value = names.length
      ? names.map(u => `    ${u.toLowerCase()}: ['${edits[u][0]}', '${edits[u][1]}']`).join(',\n')
      : '// Arm a chip, then click a mugshot. The lines to paste appear here.';
  }

  async function copyOut() {
    try {
      await navigator.clipboard.writeText(els.out.value);
      setHint('Copied. Paste into SUSPECT_COLORS in js/suspect-colors.js.');
    } catch {
      els.out.select();
      setHint('Could not reach the clipboard &mdash; the text is selected, copy it by hand.');
    }
  }

  function resetAll() {
    if (!Object.keys(edits).length) return;
    if (!window.confirm('Discard every edit and go back to the sampled colours?')) return;

    const names = Object.keys(edits);
    edits = {};
    localStorage.removeItem(STORE);
    names.forEach(paint);
    renderOut();
    setHint('Reset to the sampled colours.');
  }

  // ===== CHROME =====
  function setStatus(message, kind) {
    if (!els.status) return;
    els.status.innerHTML = message;
    els.status.classList.remove('join-status-good', 'join-status-bad', 'join-status-note');
    if (kind) els.status.classList.add(`join-status-${kind}`);
  }

  function setHint(message) {
    if (els.hint) els.hint.innerHTML = message;
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
