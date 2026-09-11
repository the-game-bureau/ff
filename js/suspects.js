const SUSPECTS_CONFIG = window.FF_SUPABASE_CONFIG || {};
const SUSPECTS_SUPABASE_URL = SUSPECTS_CONFIG.url || 'https://vkoczgzizzppdrpvpemh.supabase.co';
const SUSPECTS_SUPABASE_ANON_KEY = SUSPECTS_CONFIG.publishableKey || 'sb_publishable_XfvD3zCvnCHT1v_EGE-LJA_3Z9bGjKw';
const SUSPECTS_VIEW = SUSPECTS_CONFIG.views?.currentSuspects || 'ff_current_suspects';
const SUSPECTS_PROFILES_TABLE = SUSPECTS_CONFIG.tables?.profiles || 'ff_profiles';
const DEFAULT_MUGSHOT_URL = new URL('../src/generated/mugshot-placeholder.svg', window.location.href).href;

const suspectsDb = window.supabase ? window.supabase.createClient(SUSPECTS_SUPABASE_URL, SUSPECTS_SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    // The URL belongs to js/auth-corner.js: one client reads the one-time
    // token a recovery link carries, and several racing for it is why setting
    // a new password did nothing.
    detectSessionInUrl: false,
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

function viewSelect(showFirstNames, withStatus = true){
  // id, because the board is ordered by how many picks each suspect has filed
  // and picks are matched on user_id. A username can be changed from the rap
  // sheet, so it is not an identity to count by.
  const fields = ['id', 'username'];
  if(showFirstNames) fields.push('first_name');
  fields.push('avatar_data_url');
  // Who is out. The view derives it from the newest pick, and until now nobody
  // asked for it - gameStatusForSuspect() has been answering SUSPECT for
  // everyone since the column was never in the select.
  if(withStatus) fields.push('game_status');
  return fields.join(', ');
}

function displayNameForSuspect(suspect){
  return (suspect.display_name || suspect.first_name || suspect.username || 'Unknown').trim();
}

// The same free-text match the rest of the site makes on a result.
function isOutOfTheGame(suspect){
  return gameStatusForSuspect(suspect).includes('DUN DUN');
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
    // The one card whose record the viewer is allowed to edit. Everything
    // downstream keys off this flag, so there is a single place that decides
    // whose card is theirs. js/rap-sheet.js does the editing.
    is_self: true,
    first_name: showFirstNames ? suspect.first_name || metadata.firstName : '',
    display_name: showFirstNames && (suspect.first_name || metadata.firstName) ?
      (suspect.first_name || metadata.firstName) :
      suspect.username,
    avatar_data_url: suspect.avatar_data_url || metadata.avatarDataUrl
  };
}

// Which band of the board a suspect sits in, in the order they are drawn. The
// numbers are the colours of the week line under the name: none, yellow, green,
// plain. Keep this in step with weekLineHtml - they are two readings of the
// same state, and a suspect sorted into a band whose colour they are not
// wearing is the bug this exists to prevent.
const BAND_CLOSED = 0;
const BAND_WAITING = 1;
const BAND_CLEARED = 2;
const BAND_FILED = 3;

function lineupBand(suspect){
  if(isOutOfTheGame(suspect)) return BAND_CLOSED;
  if(suspect.filed_open_week) return BAND_FILED;
  return suspect.cleared_this_week ? BAND_CLEARED : BAND_WAITING;
}

function normalizeSuspects(suspects, user, showFirstNames, pickWeeks = new Map()){
  const thisWeek = Number(window.CURRENT_WEEK) || 1;

  return (suspects || [])
    .map((suspect) => {
      const filed = pickWeeks.get(String(suspect.id || '')) || EMPTY_WEEKS;
      // Survive the week being played and the week you are waiting on is the
      // next one, not this one. Everyone else is still on this week, whether
      // they have filed for it or not.
      const clearedThisWeek = (filed.get(thisWeek) || '').includes('SURVIVED');
      const openWeek = clearedThisWeek ? thisWeek + 1 : thisWeek;
      return addCurrentUserProfileData({
        ...suspect,
        // Weeks filed, never rows: the view collapses history per (user,
        // season, week), so a second season on file would otherwise hand back
        // two rows for week 1 and count them both.
        pick_count: filed.size,
        open_week: openWeek,
        filed_open_week: filed.has(openWeek),
        cleared_this_week: clearedThisWeek,
        display_name: showFirstNames && suspect.first_name ? suspect.first_name : suspect.username,
        game_status: suspect.game_status || suspect.status || 'SUSPECT'
      }, user, showFirstNames);
    })
    // The board reads top to bottom in the order the name plates are coloured:
    // closed cases, then anyone the clock is running on, then anyone already
    // through to next week, then the picks still waiting on Sunday. Alphabetical
    // inside a band, so the order holds still between loads rather than
    // reshuffling on whatever came back first.
    //
    // One pick per week is the most anyone can have, so the number that orders
    // the board is the open week's: filed or not, nothing else. It used to be a
    // running total of weeks filed, which counted a pick already banked for next
    // week and pushed whoever had worked ahead to the bottom of their own band -
    // three suspects who were level with everyone else on the week being played.
    // That is the band's job to say, and it already says it.
    .sort((a, b) => {
      const byBand = lineupBand(a) - lineupBand(b);
      if(byBand) return byBand;

      return (a.username || '').localeCompare(b.username || '', undefined, { sensitivity: 'base' });
    });
}

// Which weeks each suspect has named a victim for, out of the ones close enough
// to matter: everything up to and including next week. The set size orders the
// board; whether this week is in it decides what the name plate says.
//
// Capped there on purpose. A pick can be filed for any week of the season at
// any time, so counting all of them would put whoever filled in the whole
// season last on a board meant to show who is behind. Up to next week is the
// question actually being asked - are you caught up.
//
// SKIP rows are tombstones for a released week, not picks. NO PICK rows are the
// scorer's verdict on a week nobody filed, which is the opposite of a pick.
//
// Keyed by week rather than tallied as rows: one pick per week is the most
// anyone can have, so a week can only ever add one. The view collapses history
// per (user, season, week), which means a second season on file would hand back
// two rows for week 1 and quietly count them both. The value is the result, so
// the name plate can tell a pick still waiting on Sunday from one already won.
const EMPTY_WEEKS = new Map();

async function fetchPickWeeks(){
  const weeks = new Map();
  const throughWeek = (Number(window.CURRENT_WEEK) || 1) + 1;
  const season = String(window.SEASON || '');

  const { data, error } = await suspectsDb
    .from(SUSPECTS_CONFIG.views?.activePicks || 'ff_active_picks')
    .select('user_id, season, week, team, result');

  if(error){
    // Not fatal: without counts every suspect scores zero and the board falls
    // back to plain alphabetical, which is where it started.
    console.warn('Pick counts unavailable, ordering the lineup by name:', error);
    return weeks;
  }

  for(const row of data || []){
    const id = String(row?.user_id || '');
    if(!id) continue;
    const week = Number(row.week);
    if(!week || week > throughWeek) continue;
    if(season && String(row.season || season) !== season) continue;
    if(String(row.result || '').trim().toUpperCase() === 'SKIP') continue;
    if(String(row.team || '').trim().toUpperCase() === 'NO PICK') continue;
    if(!weeks.has(id)) weeks.set(id, new Map());
    weeks.get(id).set(week, String(row.result || '').trim().toUpperCase());
  }

  return weeks;
}

// The bottom line of the name plate: which week this suspect is on, and whether
// they have filed for it. A closed case gets nothing - there is no pick left to
// wait for, and the DUN DUN stamp across the photograph has already said it.
//
// Waiting is yellow when the week is still live, because the clock is running
// on them, and green when they have already survived it, because the wait is
// just the schedule catching up.
function weekLineHtml(suspect, isOut){
  if(isOut) return '';

  const week = Number(suspect.open_week) || Number(window.CURRENT_WEEK) || 1;
  if(suspect.filed_open_week) return `<span class="suspect-week">Pick is in for Week ${week}</span>`;

  const tone = suspect.cleared_this_week ? 'suspect-week-cleared' : 'suspect-week-waiting';
  return `<span class="suspect-week ${tone}">Waiting for Week ${week} pick</span>`;
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

    // Editing your own record lives in the preview, not under the card: it
    // starts from the picture, so it belongs where the picture is being looked
    // at. Only your own card offers it - it is not rendered-and-hidden on the
    // others, because there is nothing anyone else is allowed to do. It used to
    // say Retake Mugshot and change only the photograph; the whole sheet is
    // editable now, so it says so.
    // Eliminated: the case is closed and the file gets crossed out. Derived
    // from the newest pick's result, so a suspect stamped here is the same one
    // the Suspect Tracker shows a DUN DUN for.
    const isOut = isOutOfTheGame(suspect);

    const retake = suspect.is_self
      ? ' data-mugshot-action="Edit Rap Sheet" data-mugshot-action-flag="rap-sheet"'
      : '';

    return `
      <li class="suspect-card${suspect.is_self ? ' suspect-card-self' : ''}${isOut ? ' suspect-card-out' : ''}" data-username="${escapeHtml(username)}">
        <div class="suspect-avatar-frame">
          <!-- The photo, and only the photo. Its own box so the DUN DUN stamp
               centres on the picture rather than on the whole polaroid, and so
               nothing written below can creep back over it. -->
          <div class="suspect-photo">
            ${isOut ? '<span class="suspect-stamp" aria-hidden="true">Dun Dun</span><span class="sr-only">Case closed.</span>' : ''}
            <button class="suspect-avatar-button" type="button" data-mugshot-lightbox data-mugshot-src="${escapeHtml(avatarSrc)}" data-mugshot-alt="${escapeHtml(avatarLabel)}" data-mugshot-caption="${escapeHtml(username)}" data-mugshot-subcaption="${escapeHtml(firstName)}"${retake} aria-label="${escapeHtml(avatarLabel)}">
              <img class="suspect-avatar" src="${escapeHtml(avatarSrc)}" alt="${escapeHtml(avatarLabel)}" width="128" height="128"/>
            </button>
          </div>
          <!-- Written on the wide bottom border, the way a polaroid is. -->
          <div class="suspect-caption">
            <strong class="suspect-team">${escapeHtml(username)}</strong>
            ${firstName ? `<span class="suspect-first">${escapeHtml(firstName)}</span>` : ''}
            ${weekLineHtml(suspect, isOut)}
          </div>
        </div>
      </li>
    `;
  }).join('');

  fitTeamNames(grid);
  paintPlacardStripes(grid);

  // The overrides arrive from the database after this first paint, so paint the
  // grid again once they do. Painting is setting two custom properties, and the
  // event only fires when there is at least one override to apply.
  window.addEventListener('ff-suspect-colors-loaded', () => paintPlacardStripes(grid), { once: true });
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

    // The same overrides the Suspect Tracker reads, so a suspect whose colours
    // were chosen by hand looks identical on both pages rather than sampled
    // here and overridden there. See js/suspect-colors.js.
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

  // game_status is a nice-to-have: without it nobody is stamped, which is a
  // lineup missing a mark rather than a lineup missing. Dropped first, before
  // the first_name retry below, so a failure over it never costs the names too.
  if(result.error){
    const withoutStatus = await suspectsDb
      .from(SUSPECTS_VIEW)
      .select(viewSelect(showFirstNames, false))
      .order('username', { ascending: true });
    if(!withoutStatus.error) return withoutStatus;
  }

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
  // the page dead whenever the view existed but refused the query - a grant
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

  const suspects = normalizeSuspects(data || [], user, showFirstNames, await fetchPickWeeks());
  // The count lives in the heading now, so the status line has nothing left to
  // say on success and clears itself. It still carries loading and errors.
  setSuspectsTitle(suspects.length);
  setSuspectsStatus('', '');
  renderSuspects(suspects);
  openRequestedSuspect();
}

// ===== ARRIVING FROM THE CASE FILE =====
// The Suspect Tracker's mugshot preview offers a way over to this page, and it
// hands the suspect across in the query string. Dropping the visitor on a grid
// of thirty faces and leaving them to find the same one again would undo the
// point of the button, so the card they asked for opens itself.
//
// The card's own trigger is clicked rather than the lightbox being called
// directly: that button already carries the photo, the caption, the first name
// and - on your own card and no other - the Retake action, so a synthetic click
// is bound to produce exactly the preview a real one would.
let requestedSuspectOpened = false;

function openRequestedSuspect(){
  if(requestedSuspectOpened) return;

  const wanted = new URLSearchParams(window.location.search).get('suspect');
  if(!wanted) return;

  // Usernames are stored with their own capitalisation and matched
  // case-insensitively everywhere else on the site.
  const key = wanted.trim().toLowerCase();
  const card = [...document.querySelectorAll('.suspect-card')]
    .find((el) => (el.dataset.username || '').trim().toLowerCase() === key);
  // Not marked done when there is no match: the first render can be the
  // signed-out roster, and the name may only turn up on the next one.
  if(!card) return;

  requestedSuspectOpened = true;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.querySelector('.suspect-avatar-button')?.click();

  // Taken back out of the address bar, so a reload - or a link copied from
  // here - is just the suspects page.
  const url = new URL(window.location.href);
  url.searchParams.delete('suspect');
  window.history.replaceState({}, '', url.pathname + url.search + url.hash);
}

document.addEventListener('DOMContentLoaded', loadCurrentSuspects);

window.addEventListener('ff-auth-changed', loadCurrentSuspects);
