const SUSPECTS_CONFIG = window.FF_SUPABASE_CONFIG || {};
const SUSPECTS_SUPABASE_URL = SUSPECTS_CONFIG.url || 'https://vkoczgzizzppdrpvpemh.supabase.co';
const SUSPECTS_SUPABASE_ANON_KEY = SUSPECTS_CONFIG.publishableKey || 'sb_publishable_XfvD3zCvnCHT1v_EGE-LJA_3Z9bGjKw';
const SUSPECTS_VIEW = SUSPECTS_CONFIG.views?.currentSuspects || 'ff_current_suspects';
const SUSPECTS_PROFILES_TABLE = SUSPECTS_CONFIG.tables?.profiles || 'ff_profiles';
const DEFAULT_MUGSHOT_URL = new URL('../src/generated/mugshot-placeholder.svg', window.location.href).href;

const suspectsDb = window.supabase ? window.supabase.createClient(SUSPECTS_SUPABASE_URL, SUSPECTS_SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    storageKey: SUSPECTS_CONFIG.storageKey || 'law-order-svu-auth-vkoczgzizzppdrpvpemh',
    storage: window.localStorage
  }
}) : null;

function setSuspectsStatus(message, kind){
  const el = document.getElementById('suspectsStatus');
  if(!el) return;

  el.textContent = message;
  el.classList.remove('suspects-status-good', 'suspects-status-bad');
  if(kind) el.classList.add(`suspects-status-${kind}`);
}

// The count reads as part of the heading rather than as a separate line
// under it: "3 CURRENT SUSPECTS", "1 CURRENT SUSPECT".
function setSuspectsTitle(count){
  const el = document.getElementById('currentSuspectsTitle');
  if(!el) return;

  el.textContent = `${count} Suspect${count === 1 ? '' : 's'}`;
}

// The header line counts the faces pinned to the board, so it grows with the
// league on its own.
function setLineupCall(count){
  const el = document.getElementById('lineupCall');
  if(!el) return;

  const total = Number(count || 0);
  el.textContent = total === 1
    ? '"One face on the board. Nobody comes down until the case closes."'
    : `"${total} faces on the board. Nobody comes down until the case closes."`;
}

function escapeHtml(value){
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeAvatarSrc(value){
  const src = String(value || '');
  return /^data:image\/(?:png|jpeg|webp);base64,/i.test(src) ? src : '';
}

function optionalColumnError(error, columnName){
  const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
  return error?.code === 'PGRST204' && text.includes(columnName) ||
    error?.code === '42703' && text.includes(columnName) ||
    (text.includes('column') && text.includes(columnName));
}

function profileSelect(showFirstNames, includeAvatar = true){
  const fields = ['id', 'username'];
  if(showFirstNames) fields.push('first_name');
  if(includeAvatar) fields.push('avatar_data_url');
  return fields.join(', ');
}

function viewSelect(showFirstNames){
  const fields = ['username'];
  if(showFirstNames) fields.push('first_name');
  fields.push('avatar_data_url');
  return fields.join(', ');
}

function displayNameForSuspect(suspect){
  return (suspect.display_name || suspect.first_name || suspect.username || 'Unknown').trim();
}

function gameStatusForSuspect(suspect){
  return (suspect.game_status || suspect.status || 'SUSPECT').trim().toUpperCase();
}

function metadataForCurrentUser(user){
  return {
    id: user?.id || '',
    username: (user?.user_metadata?.username || '').trim(),
    firstName: (user?.user_metadata?.first_name || '').trim(),
    avatarDataUrl: user?.user_metadata?.avatar_data_url || ''
  };
}

function addCurrentUserProfileData(suspect, user, showFirstNames){
  const metadata = metadataForCurrentUser(user);
  const isCurrentUser =
    Boolean(metadata.id && suspect.id === metadata.id) ||
    Boolean(metadata.username && suspect.username === metadata.username);

  if(!isCurrentUser) return suspect;

  return {
    ...suspect,
    // The one card whose photo the viewer is allowed to replace. Everything
    // downstream keys off this flag, so there is a single place that decides
    // whose card is theirs. js/mugshot-edit.js does the replacing.
    is_self: true,
    first_name: showFirstNames ? suspect.first_name || metadata.firstName : '',
    display_name: showFirstNames && (suspect.first_name || metadata.firstName) ?
      (suspect.first_name || metadata.firstName) :
      suspect.username,
    avatar_data_url: suspect.avatar_data_url || metadata.avatarDataUrl
  };
}

function normalizeSuspects(suspects, user, showFirstNames){
  return (suspects || [])
    .map((suspect) => addCurrentUserProfileData({
      ...suspect,
      display_name: showFirstNames && suspect.first_name ? suspect.first_name : suspect.username,
      game_status: suspect.game_status || suspect.status || 'SUSPECT'
    }, user, showFirstNames))
    .sort((a, b) => (a.username || '').localeCompare(b.username || ''));
}

function renderSuspects(suspects){
  const grid = document.getElementById('suspectGrid');
  if(!grid) return;

  if(!suspects.length){
    grid.innerHTML = '<li class="suspect-empty">No suspects booked yet.</li>';
    return;
  }

  grid.innerHTML = suspects.map((suspect) => {
    const username = suspect.username || 'unknown';
    // Second line only exists for signed-in visitors: first_name is withheld
    // from the public view, so it arrives empty when signed out and the line
    // is dropped rather than left blank.
    const firstName = (suspect.first_name || '').trim();
    const avatarSrc = safeAvatarSrc(suspect.avatar_data_url) || DEFAULT_MUGSHOT_URL;
    const avatarLabel = `${displayNameForSuspect(suspect)} mugshot`;

    // Only your own card carries the control. It is not rendered-and-hidden on
    // the others: there is nothing to hide, because there is nothing anyone
    // else is allowed to do here.
    const selfEdit = suspect.is_self
      ? `<button class="suspect-mugshot-edit" type="button" data-mugshot-edit
                 aria-label="Replace your mugshot">Retake Mugshot</button>`
      : '';

    return `
      <li class="suspect-card${suspect.is_self ? ' suspect-card-self' : ''}" data-username="${escapeHtml(username)}">
        <div class="suspect-avatar-frame">
          <button class="suspect-avatar-button" type="button" data-mugshot-lightbox data-mugshot-src="${escapeHtml(avatarSrc)}" data-mugshot-alt="${escapeHtml(avatarLabel)}" data-mugshot-caption="${escapeHtml(username)}" aria-label="${escapeHtml(avatarLabel)}">
            <img class="suspect-avatar" src="${escapeHtml(avatarSrc)}" alt="${escapeHtml(avatarLabel)}" width="128" height="128"/>
          </button>
          <!-- The name plate sits on the photo, the way a booking board does. -->
          <div class="suspect-caption">
            <strong class="suspect-team">${escapeHtml(username)}</strong>
            ${firstName ? `<span class="suspect-first">${escapeHtml(firstName)}</span>` : ''}
          </div>
        </div>
        ${selfEdit}
      </li>
    `;
  }).join('');

  fitTeamNames(grid);
  paintPlacardStripes(grid);
}

// ===== STRIPE COLOURS FROM THE MUGSHOT =====
// Each placard's two-tone edge is sampled from that suspect's own photo, so
// the lineup reads as a set of individual case files rather than 32 copies of
// the same card. Falls back silently to the house colours: a placard with the
// default stripe is not a bug worth reporting to the player.
const STRIPE_SAMPLE_SIZE = 24;

function paintPlacardStripes(grid){
  for(const card of grid.querySelectorAll('.suspect-card')){
    const img = card.querySelector('.suspect-avatar');
    // The stripes are drawn on the mugshot frame itself now.
    const placard = card.querySelector('.suspect-avatar-frame');
    if(!img || !placard) continue;

    const apply = (colors) => {
      if(!colors) return;
      placard.style.setProperty('--stripe-a', colors[0]);
      placard.style.setProperty('--stripe-b', colors[1]);
    };

    // The same exception list the Suspect Tracker reads, so a suspect whose
    // colours were chosen by hand looks identical on both pages rather than
    // sampled here and overridden there. See js/suspect-colors.js.
    const override = window.suspectColorOverride?.(card.dataset.username);
    if(override){ apply(override); continue; }

    // decode() resolves once the pixels are actually available, including for
    // an image already in cache, where load may never fire again.
    const ready = img.complete && img.naturalWidth
      ? Promise.resolve()
      : img.decode().catch(() => null);

    ready.then(() => apply(dominantPair(img))).catch(() => {});
  }
}

// Two colours: the most common one in the photo, then the most common one that
// is far enough away from it to read as a separate band.
function dominantPair(img){
  let pixels;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = STRIPE_SAMPLE_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, STRIPE_SAMPLE_SIZE, STRIPE_SAMPLE_SIZE);
    pixels = ctx.getImageData(0, 0, STRIPE_SAMPLE_SIZE, STRIPE_SAMPLE_SIZE).data;
  } catch(error) {
    // A cross-origin image taints the canvas and getImageData throws. Mugshots
    // are data: URLs so this should not happen, but the default stripe is a
    // perfectly good answer if it does.
    return null;
  }

  // Buckets of 32 per channel: fine enough to tell a shirt from a background,
  // coarse enough that shading does not split one colour into twenty.
  const buckets = new Map();
  for(let i = 0; i < pixels.length; i += 4){
    if(pixels[i + 3] < 128) continue;
    const r = pixels[i] >> 5, g = pixels[i + 1] >> 5, b = pixels[i + 2] >> 5;
    const key = (r << 10) | (g << 5) | b;
    const entry = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    entry.count++;
    entry.r += pixels[i];
    entry.g += pixels[i + 1];
    entry.b += pixels[i + 2];
    buckets.set(key, entry);
  }

  const ranked = [...buckets.values()]
    .map(e => ({ count: e.count, r: Math.round(e.r / e.count), g: Math.round(e.g / e.count), b: Math.round(e.b / e.count) }))
    .sort((a, b) => b.count - a.count);

  if(!ranked.length) return null;

  const first = ranked[0];
  // Far enough apart to be two bands rather than one thick one.
  const MIN_DISTANCE = 60;
  const second = ranked.find(c => colorDistance(c, first) > MIN_DISTANCE) || ranked[1] || first;

  return [toCssRgb(first), toCssRgb(second)];
}

function colorDistance(a, b){
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function toCssRgb(c){
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

// The team name holds one line whatever its length: it gives up type size
// rather than wrapping or being clipped, so every placard keeps the same
// three-line shape. Measured after the markup lands, since the available
// width is not known until then.
function fitTeamNames(grid){
  const MAX_PX = 17;
  const MIN_PX = 8;

  for(const el of grid.querySelectorAll('.suspect-team')){
    for(let size = MAX_PX; size >= MIN_PX; size -= 0.5){
      el.style.fontSize = `${size}px`;
      if(el.scrollWidth <= el.clientWidth) break;
    }
  }
}

async function fetchProfiles(showFirstNames){
  let includeFirstNames = showFirstNames;
  let includeAvatar = true;

  for(let attempt = 0; attempt < 3; attempt++){
    const { data, error } = await suspectsDb
      .from(SUSPECTS_PROFILES_TABLE)
      .select(profileSelect(includeFirstNames, includeAvatar))
      .order('username', { ascending: true });

    if(!error) return { data: data || [], error: null };
    if(includeFirstNames && optionalColumnError(error, 'first_name')){
      includeFirstNames = false;
      continue;
    }
    if(includeAvatar && optionalColumnError(error, 'avatar_data_url')){
      includeAvatar = false;
      continue;
    }

    return { data: null, error };
  }

  return { data: null, error: new Error('Profile columns could not be loaded.') };
}

async function fetchSuspectsFromBaseTables(showFirstNames){
  const profilesResult = await fetchProfiles(showFirstNames);
  if(profilesResult.error) return profilesResult;

  return {
    data: profilesResult.data || [],
    error: null
  };
}

async function fetchSuspectsFromView(showFirstNames){
  let result = await suspectsDb
    .from(SUSPECTS_VIEW)
    .select(viewSelect(showFirstNames))
    .order('username', { ascending: true });

  // first_name is the only optional column in this select, and it can fail in
  // more ways than "column missing": the view grants it per role, so a role
  // without it gets 42501 "permission denied for view", which names no column
  // at all. Retrying on any error rather than on a recognised one keeps the
  // lineup loading instead of failing the whole page over a nice-to-have field.
  if(result.error && showFirstNames){
    result = await suspectsDb
      .from(SUSPECTS_VIEW)
      .select(viewSelect(false))
      .order('username', { ascending: true });
  }

  if(result.error && optionalColumnError(result.error, 'avatar_data_url')){
    const fields = ['username'];
    if(showFirstNames) fields.splice(1, 0, 'first_name');
    return await suspectsDb
      .from(SUSPECTS_VIEW)
      .select(fields.join(', '))
      .order('username', { ascending: true });
  }

  return result;
}

async function loadCurrentSuspects(){
  if(!suspectsDb){
    setSuspectsStatus('Lineup room is offline. Refresh and try again.', 'bad');
    return;
  }

  const { data: { user } } = await suspectsDb.auth.getUser();
  const showFirstNames = Boolean(user);

  setSuspectsStatus('Loading lineup...', '');

  let { data, error } = await fetchSuspectsFromView(showFirstNames);

  // The view is a convenience, not the source of truth: ff_profiles holds the
  // same rows. It used to fall back only when the view was missing, which left
  // the page dead whenever the view existed but refused the query — a grant
  // the current role lacks, a column that moved. Any failure now falls through
  // to the table, and only a failure of both is reported.
  if(error){
    console.warn('Suspects view failed, falling back to ff_profiles:', error);
    ({ data, error } = await fetchSuspectsFromBaseTables(showFirstNames));
  }

  if(error){
    // Include the code: PostgREST messages like "Bad Request" say nothing on
    // their own, and the code is what identifies the actual problem.
    const code = error.code ? ` (${error.code})` : '';
    setSuspectsStatus(`Lineup fetch failed: ${error.message}${code}`, 'bad');
    console.error('Lineup fetch failed:', error);
    return;
  }

  const suspects = normalizeSuspects(data || [], user, showFirstNames);
  // The count lives in the heading now, so the status line has nothing left to
  // say on success and clears itself. It still carries loading and errors.
  setSuspectsTitle(suspects.length);
  setLineupCall(suspects.length);
  setSuspectsStatus('', '');
  renderSuspects(suspects);
}

document.addEventListener('DOMContentLoaded', loadCurrentSuspects);

window.addEventListener('ff-auth-changed', loadCurrentSuspects);
