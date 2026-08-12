const SUSPECTS_SUPABASE_URL = 'https://qmaafbncpzrdmqapkkgr.supabase.co';
const SUSPECTS_SUPABASE_ANON_KEY = 'sb_publishable_6a9XqxYa0-AZtyrwz4ZeUg_aiMsVH-3';
const SUSPECTS_VIEW = 'ff_current_suspects';
const SUSPECTS_PROFILES_TABLE = 'ff_profiles';
const DEFAULT_MUGSHOT_URL = new URL('../src/generated/mugshot-placeholder.svg', window.location.href).href;

const suspectsDb = window.supabase ? window.supabase.createClient(SUSPECTS_SUPABASE_URL, SUSPECTS_SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    storageKey: 'law-order-svu-auth-qmaafbncpzrdmqapkkgr',
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

  el.textContent = `${count} Current Suspect${count === 1 ? '' : 's'}`;
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

function missingRelationError(error){
  const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
  return error?.code === 'PGRST205' ||
    error?.code === '42P01' ||
    text.includes('schema cache') ||
    text.includes('could not find the table') ||
    text.includes('does not exist');
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
    const avatarSrc = safeAvatarSrc(suspect.avatar_data_url) || DEFAULT_MUGSHOT_URL;
    const status = gameStatusForSuspect(suspect);
    const avatarLabel = `${displayNameForSuspect(suspect)} mugshot`;

    return `
      <li class="suspect-card">
        <div class="suspect-avatar-frame">
          <button class="suspect-avatar-button" type="button" data-mugshot-lightbox data-mugshot-src="${escapeHtml(avatarSrc)}" data-mugshot-alt="${escapeHtml(avatarLabel)}" aria-label="${escapeHtml(avatarLabel)}">
            <img class="suspect-avatar" src="${escapeHtml(avatarSrc)}" alt="${escapeHtml(avatarLabel)}" width="128" height="128"/>
          </button>
        </div>
        <div class="suspect-placard">
          <strong class="suspect-name">${escapeHtml(displayNameForSuspect(suspect))}</strong>
          <span class="suspect-username">${escapeHtml(username)}</span>
          <span class="suspect-status">${escapeHtml(status)}</span>
        </div>
      </li>
    `;
  }).join('');
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
  const result = await suspectsDb
    .from(SUSPECTS_VIEW)
    .select(viewSelect(showFirstNames))
    .order('username', { ascending: true });

  if(result.error && showFirstNames && optionalColumnError(result.error, 'first_name')){
    return await suspectsDb
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
  if(error && missingRelationError(error)){
    ({ data, error } = await fetchSuspectsFromBaseTables(showFirstNames));
  }

  if(error){
    setSuspectsStatus(`Lineup fetch failed: ${error.message}`, 'bad');
    return;
  }

  const suspects = normalizeSuspects(data || [], user, showFirstNames);
  // The count lives in the heading now, so the status line has nothing left to
  // say on success and clears itself. It still carries loading and errors.
  setSuspectsTitle(suspects.length);
  setSuspectsStatus('', '');
  renderSuspects(suspects);
}

document.addEventListener('DOMContentLoaded', loadCurrentSuspects);

window.addEventListener('ff-auth-changed', loadCurrentSuspects);
