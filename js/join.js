// ===== JOIN =====
// The booking form. It lives in two places from one copy: join/index.html
// renders it inline, and js/join-modal.js injects the same markup into a popup
// on every other page. Same ids either way, so everything below binds to
// whichever one is on the page.
//
// Wrapped in an IIFE because it is now loaded site-wide, and its top-level
// names would otherwise collide with another page script's — suspects.js
// declares its own DEFAULT_MUGSHOT_URL, and two top-level consts of one name
// is a parse error that kills both files.
(function () {
const JOIN_CONFIG = window.FF_SUPABASE_CONFIG || {};
const JOIN_SUPABASE_URL = JOIN_CONFIG.url || 'https://qmaafbncpzrdmqapkkgr.supabase.co';
const JOIN_SUPABASE_ANON_KEY = JOIN_CONFIG.publishableKey || 'sb_publishable_6a9XqxYa0-AZtyrwz4ZeUg_aiMsVH-3';
const JOIN_PROFILES_TABLE = JOIN_CONFIG.tables?.profiles || 'ff_profiles';
const JOIN_AUTH_STORAGE_KEY = JOIN_CONFIG.storageKey || 'law-order-svu-auth-qmaafbncpzrdmqapkkgr';
const PENDING_JOIN_STORAGE_KEY = `ff-pending-join-${JOIN_CONFIG.projectRef || JOIN_SUPABASE_URL}`;
const PENDING_JOIN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const MUGSHOT_STORAGE_SIZE = 256;
// Mugshots are photographs, which PNG stores badly — the same 256px image is
// roughly 12x smaller as JPEG. Every stored mugshot is fetched again for each
// player in the lineup, so the saving is per row, per visitor. Both mugshot
// canvases paint an opaque white ground first, so there is no transparency for
// JPEG to lose. 0.82 is the usual sweet spot before artefacts show on faces.
const MUGSHOT_JPEG_TYPE = 'image/jpeg';
const MUGSHOT_JPEG_QUALITY = 0.82;
// Every page's nav mount carries the hop back to the site root; the form can
// now open from any depth, so paths are resolved through it rather than
// assuming this file is one directory down.
function joinPagePrefix(){
  return document.getElementById('siteNav')?.dataset.prefix || '';
}

function joinRootUrl(path){
  return new URL(`${joinPagePrefix()}${path}`, window.location.href).href;
}

// Resolved on use, not at load: the nav mount is read for the prefix and this
// file can run before it exists.
function defaultMugshotUrl(){
  return joinRootUrl('src/generated/mugshot-placeholder.svg');
}

let renderedAvatarDataUrl = '';
let renderedAvatarFileKey = '';

const joinDb = window.supabase ? window.supabase.createClient(JOIN_SUPABASE_URL, JOIN_SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    storageKey: JOIN_AUTH_STORAGE_KEY,
    storage: window.localStorage
  }
}) : null;

function setJoinStatus(message, kind){
  const statusEl = document.getElementById('joinStatus');
  if(!statusEl) return;

  statusEl.textContent = message;
  statusEl.classList.remove('join-status-good', 'join-status-bad');
  if(kind) statusEl.classList.add(`join-status-${kind}`);
}

// A message at the bottom of a seven-field form does not say which field it is
// about, so the offending input is outlined and focused too.
function clearJoinFieldFlags(){
  document.querySelectorAll('.join-form .join-input-bad')
    .forEach(input => input.classList.remove('join-input-bad'));
}

function flagJoinField(fieldId){
  clearJoinFieldFlags();

  const input = fieldId ? document.getElementById(fieldId) : null;
  if(!input) return;

  input.classList.add('join-input-bad');
  input.focus();
  // Passwords get retyped, not edited, so the old one is selected ready to be
  // overwritten. Selecting a half-typed username would throw it away instead.
  if(input.type === 'password') input.select();
}

// "Already booked" would claim they are in this league, which is not something
// this error proves: the login may have been created on another site sharing
// this Supabase project. Logging in is the right next step either way — the
// join form fills in the league record afterwards for an account that has none.
const EMAIL_TAKEN_MESSAGE =
  'That email already has a login. Log in, then come back here to finish joining ' +
  'the league. Reset your password if you have forgotten it.';

// Report what actually happened. Only the already-registered case gets its own
// wording, because that one is common and actionable; everything else passes
// the real message through rather than hiding it behind "unexpected error".
function bookingErrorMessage(error){
  // Only a real message or a plain string; anything else stringifies to
  // "[object Object]", which is no more use than "unexpected error".
  const message = String(error?.message || (typeof error === 'string' ? error : '')).trim();
  const lower = message.toLowerCase();

  if(error?.code === 'user_already_exists' ||
     lower.includes('already registered') ||
     lower.includes('already been registered') ||
     lower.includes('user already exists')){
    return EMAIL_TAKEN_MESSAGE;
  }

  return message ? `Booking error: ${message}` : 'Booking error.';
}

function setAvatarStatus(message, kind){
  const statusEl = document.getElementById('avatarStatus');
  if(!statusEl) return;

  statusEl.textContent = message;
  statusEl.classList.remove('avatar-status-good', 'avatar-status-bad');
  if(kind) statusEl.classList.add(`avatar-status-${kind}`);
}

function redirectToSuspects(delay = 800){
  window.setTimeout(() => {
    window.location.href = joinRootUrl('suspects/index.html');
  }, delay);
}

// Every failure below names the field and the rule it broke, and comes back
// with the id to focus, so the form does not just say no. The form carries
// `novalidate` for the same reason: the browser's "Please match the requested
// format" bubble on the username pattern told nobody anything.
function joinProblem(message, fieldId){
  return { message, fieldId };
}

// The characters actually typed that the username rule rejects, quoted back so
// the fix is obvious. Deduped and capped, because pasting a sentence in here
// would otherwise produce a wall of punctuation.
function illegalUsernameCharacters(username){
  const bad = [...new Set(username.replace(/[A-Za-z0-9_]/g, '').split(''))];
  const shown = bad.slice(0, 5).map(ch => `"${ch}"`).join(' ');
  return bad.length > 5 ? `${shown} and more` : shown;
}

function validateUsername(username){
  if(!username) return joinProblem('Enter a username. It is the name on your mugshot placard.', 'joinUsername');

  if(/\s/.test(username)){
    return joinProblem(
      'Username cannot contain spaces. Use an underscore instead, like john_munch.',
      'joinUsername'
    );
  }

  if(username.length < 3){
    return joinProblem(
      `Username must be at least 3 characters. Yours is ${username.length}.`,
      'joinUsername'
    );
  }

  if(username.length > 20){
    return joinProblem(
      `Username must be 20 characters or fewer. Yours is ${username.length}.`,
      'joinUsername'
    );
  }

  if(!/^[A-Za-z0-9_]+$/.test(username)){
    return joinProblem(
      `Username cannot contain ${illegalUsernameCharacters(username)}. Letters, numbers, and underscores only.`,
      'joinUsername'
    );
  }

  return null;
}

function validateEmail(email){
  if(!email) return joinProblem('Enter your email address. It is private and only used to log you in.', 'joinEmail');

  if(/\s/.test(email)){
    return joinProblem('Email cannot contain spaces. Check for a stray space at the end.', 'joinEmail');
  }

  const parts = email.split('@');
  if(parts.length !== 2 || !parts[0] || !parts[1]){
    return joinProblem('Email needs one @ with something either side, like munch@example.com.', 'joinEmail');
  }

  if(!/^[^@]+\.[^@]+$/.test(parts[1])){
    return joinProblem(`"${parts[1]}" is not a complete domain. It needs a dot, like example.com.`, 'joinEmail');
  }

  return null;
}

function validateJoin({ email, username, firstName, lastName, password, passwordConfirm }){
  const usernameProblem = validateUsername(username);
  if(usernameProblem) return usernameProblem;

  if(!firstName) return joinProblem('Enter your first name. Other players see it; nobody outside the league does.', 'joinFirstName');
  if(firstName.length > 50){
    return joinProblem(`First name must be 50 characters or fewer. Yours is ${firstName.length}.`, 'joinFirstName');
  }

  if(!lastName) return joinProblem('Enter your last name. It stays private.', 'joinLastName');
  if(lastName.length > 50){
    return joinProblem(`Last name must be 50 characters or fewer. Yours is ${lastName.length}.`, 'joinLastName');
  }

  const emailProblem = validateEmail(email);
  if(emailProblem) return emailProblem;

  if(!password) return joinProblem('Enter a password of at least 6 characters.', 'joinPassword');
  if(password.length < 6){
    return joinProblem(
      `Password must be at least 6 characters. Yours is ${password.length}.`,
      'joinPassword'
    );
  }

  if(!passwordConfirm) return joinProblem('Type the password a second time to confirm it.', 'joinPasswordConfirm');
  if(password !== passwordConfirm){
    return joinProblem('The two passwords do not match. Retype them both.', 'joinPasswordConfirm');
  }

  return null;
}

function profileNameColumnsUnsupported(error){
  const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
  return error?.code === 'PGRST204' ||
    error?.code === '42703' ||
    (text.includes('column') && (text.includes('first_name') || text.includes('last_name')));
}

function profileAvatarColumnUnsupported(error){
  const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
  return error?.code === 'PGRST204' && text.includes('avatar_data_url') ||
    error?.code === '42703' && text.includes('avatar_data_url') ||
    (text.includes('column') && text.includes('avatar_data_url'));
}

async function insertProfileRow(row){
  const result = await joinDb.from(JOIN_PROFILES_TABLE).insert(row);
  if(result.error && profileAvatarColumnUnsupported(result.error)){
    const rowWithoutAvatar = { ...row };
    delete rowWithoutAvatar.avatar_data_url;
    const retry = await joinDb.from(JOIN_PROFILES_TABLE).insert(rowWithoutAvatar);
    if(retry.error && profileNameColumnsUnsupported(retry.error)){
      return await joinDb
        .from(JOIN_PROFILES_TABLE)
        .insert({
          id: row.id,
          username: row.username,
          email: row.email
        });
    }

    return retry;
  }

  if(result.error && profileNameColumnsUnsupported(result.error)){
    const rowWithoutNames = {
      id: row.id,
      username: row.username,
      email: row.email,
      avatar_data_url: row.avatar_data_url
    };
    const retry = await joinDb.from(JOIN_PROFILES_TABLE).insert(rowWithoutNames);
    if(retry.error && profileAvatarColumnUnsupported(retry.error)){
      return await joinDb
        .from(JOIN_PROFILES_TABLE)
        .insert({
          id: row.id,
          username: row.username,
          email: row.email
        });
    }

    return retry;
  }

  return result;
}

async function createProfileForSession(user, profileDetails){
  if(!user) return null;

  return await insertProfileRow({
    id: user.id,
    username: profileDetails.username,
    email: profileDetails.email,
    first_name: profileDetails.firstName,
    last_name: profileDetails.lastName,
    avatar_data_url: profileDetails.avatarDataUrl || null
  });
}

function savePendingJoin(profileDetails){
  try {
    window.localStorage.setItem(PENDING_JOIN_STORAGE_KEY, JSON.stringify({
      createdAt: Date.now(),
      email: profileDetails.email,
      username: profileDetails.username,
      firstName: profileDetails.firstName,
      lastName: profileDetails.lastName,
      avatarDataUrl: profileDetails.avatarDataUrl || null
    }));
  } catch(error) {
    console.warn('Could not save pending join profile:', error);
  }
}

function readPendingJoin(){
  let pending = null;

  try {
    pending = JSON.parse(window.localStorage.getItem(PENDING_JOIN_STORAGE_KEY) || 'null');
  } catch {
    clearPendingJoin();
    return null;
  }

  if(!pending || !pending.createdAt || Date.now() - pending.createdAt > PENDING_JOIN_MAX_AGE_MS){
    clearPendingJoin();
    return null;
  }

  return pending;
}

function clearPendingJoin(){
  try {
    window.localStorage.removeItem(PENDING_JOIN_STORAGE_KEY);
  } catch {
    // Nothing useful to do here.
  }
}

function pendingJoinMatchesUser(pending, user){
  const pendingEmail = String(pending?.email || '').toLowerCase();
  const userEmail = String(user?.email || '').toLowerCase();
  return Boolean(pendingEmail && userEmail && pendingEmail === userEmail);
}

async function finishPendingJoinForUser(user){
  if(!joinDb || !user) return false;

  const pending = readPendingJoin();
  if(!pending || !pendingJoinMatchesUser(pending, user)) return false;

  const { data: profile, error: profileFetchError } = await joinDb
    .from(JOIN_PROFILES_TABLE)
    .select('username')
    .eq('id', user.id)
    .maybeSingle();

  if(profileFetchError && profileFetchError.code !== 'PGRST116'){
    console.error('Pending profile check failed:', profileFetchError);
    return false;
  }

  if(profile){
    clearPendingJoin();
    return true;
  }

  const { error: profileError } = await createProfileForSession(user, {
    ...pending,
    email: user.email || pending.email || null
  });

  if(profileError){
    console.error('Pending profile booking failed:', profileError);
    return false;
  }

  clearPendingJoin();
  setJoinStatus('Booking complete. You are on the board.', 'good');
  window.dispatchEvent(new Event('ff-auth-changed'));
  return true;
}

async function finishPendingJoinFromCurrentSession(){
  if(!joinDb) return false;

  const { data: { user }, error } = await joinDb.auth.getUser();
  if(error || !user) return false;

  return await finishPendingJoinForUser(user);
}

async function updateSignedInUserMugshot(user, profileDetails){
  if(!user || !profileDetails.avatarDataUrl) return { error: null };

  // Spreading the existing metadata would carry a previously stored mugshot
  // straight back into the JWT, so the fields are listed explicitly and
  // avatar_data_url is deliberately absent. See the note in the signUp call:
  // anything in here ends up in the Authorization header of every request.
  const existing = { ...(user.user_metadata || {}) };
  delete existing.avatar_data_url;

  const { error: metadataError } = await joinDb.auth.updateUser({
    data: {
      ...existing,
      username: profileDetails.username,
      first_name: profileDetails.firstName,
      last_name: profileDetails.lastName
    }
  });

  if(metadataError) return { error: metadataError };

  const { error: profileError } = await joinDb
    .from(JOIN_PROFILES_TABLE)
    .update({ avatar_data_url: profileDetails.avatarDataUrl })
    .eq('id', user.id);

  if(profileError && !profileAvatarColumnUnsupported(profileError)){
    return { error: profileError };
  }

  return { error: null };
}

async function finishProfileForSignedInUser(profileDetails){
  const { data: { user } } = await joinDb.auth.getUser();
  if(!user) return false;

  const { data: profile, error: profileFetchError } = await joinDb
    .from(JOIN_PROFILES_TABLE)
    .select('username')
    .eq('id', user.id)
    .maybeSingle();

  if(profileFetchError && profileFetchError.code !== 'PGRST116'){
    setJoinStatus(`Profile check failed: ${profileFetchError.message}`, 'bad');
    return 'handled';
  }

  if(profile){
    const { error: mugshotError } = await updateSignedInUserMugshot(user, {
      ...profileDetails,
      username: profile.username
    });
    if(mugshotError){
      setJoinStatus(`Mugshot save failed: ${mugshotError.message}`, 'bad');
      return 'handled';
    }

    const savedCopy = profileDetails.avatarDataUrl ? ' Mugshot saved.' : '';
    setJoinStatus(`Already booked as ${profile.username}.${savedCopy} Taking you to Suspects.`, 'good');
    return 'redirect';
  }

  const { error: profileError } = await createProfileForSession(user, {
    ...profileDetails,
    email: user.email || profileDetails.email || null
  });
  if(profileError){
    if(profileError.code === '23505'){
      setJoinStatus('That username is already booked. Try another handle.', 'bad');
    } else {
      setJoinStatus(`Profile booking failed: ${profileError.message}`, 'bad');
    }
    return 'handled';
  }

  setJoinStatus('Booking complete. Taking you to Suspects.', 'good');
  return 'redirect';
}

function avatarFileKey(file){
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function validateMugshotFile(file){
  if(!file) throw new Error('Mugshot is missing.');
  if(!file.type || !file.type.startsWith('image/')){
    throw new Error('Mugshot must be an image file.');
  }
  if(file.size > MAX_AVATAR_BYTES){
    throw new Error('Mugshot image must be 5 MB or smaller.');
  }
}

function paintEmptyAvatarPreview(){
  const canvas = document.getElementById('avatarPreviewCanvas');
  const previewButton = document.getElementById('avatarPreviewButton');
  if(!canvas) return;

  if(previewButton) previewButton.dataset.mugshotSrc = defaultMugshotUrl();

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const placeholder = new Image();
  placeholder.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(placeholder, 0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  };
  placeholder.onerror = () => {
    ctx.fillStyle = '#E2DED2';
    for(let y = 0; y < canvas.height; y += 12){
      for(let x = (y / 12) % 2 ? 12 : 0; x < canvas.width; x += 24){
        ctx.fillRect(x, y, 12, 12);
      }
    }

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  };
  placeholder.src = defaultMugshotUrl();
}

function copyCanvasToPreview(sourceCanvas){
  const canvas = document.getElementById('avatarPreviewCanvas');
  if(!canvas) return;

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
}

function setPreviewLightboxSource(dataUrl){
  const previewButton = document.getElementById('avatarPreviewButton');
  if(!previewButton) return;

  previewButton.dataset.mugshotSrc = dataUrl || defaultMugshotUrl();
}

function loadImageFromFile(file){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Mugshot image could not be read.'));
    };

    image.src = url;
  });
}

function loadImageFromDataUrl(dataUrl){
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Mugshot image could not be read.'));
    image.src = dataUrl;
  });
}

function drawImageToSquare(ctx, image, outputSize){
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const cropSize = Math.min(sourceWidth, sourceHeight);
  const cropX = Math.floor((sourceWidth - cropSize) / 2);
  const cropY = Math.floor((sourceHeight - cropSize) / 2);

  ctx.drawImage(
    image,
    cropX,
    cropY,
    cropSize,
    cropSize,
    0,
    0,
    outputSize,
    outputSize
  );
}

async function fileToSizedDataUrl(file, maxSize, type = 'image/jpeg', quality = 0.88){
  validateMugshotFile(file);

  const image = await loadImageFromFile(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.min(1, maxSize / sourceWidth, maxSize / sourceHeight);
  const outputWidth = Math.max(1, Math.round(sourceWidth * scale));
  const outputHeight = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outputWidth;
  canvas.height = outputHeight;

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, outputWidth, outputHeight);
  ctx.drawImage(image, 0, 0, outputWidth, outputHeight);

  return canvas.toDataURL(type, quality);
}

async function renderRawMugshot(file){
  const dataUrl = await fileToSizedDataUrl(file, MUGSHOT_STORAGE_SIZE, 'image/jpeg', 0.88);
  const image = await loadImageFromDataUrl(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = MUGSHOT_STORAGE_SIZE;
  canvas.height = MUGSHOT_STORAGE_SIZE;

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, MUGSHOT_STORAGE_SIZE, MUGSHOT_STORAGE_SIZE);
  drawImageToSquare(ctx, image, MUGSHOT_STORAGE_SIZE);

  return {
    canvas,
    dataUrl
  };
}

async function prepareAvatarUpload(file){
  if(!file){
    renderedAvatarDataUrl = '';
    renderedAvatarFileKey = '';
    paintEmptyAvatarPreview();
    throw new Error('Mugshot is missing.');
  }

  const key = avatarFileKey(file);
  if(renderedAvatarDataUrl && renderedAvatarFileKey === key){
    return renderedAvatarDataUrl;
  }

  setAvatarStatus('Sizing mugshot...', '');
  const rendered = await renderRawMugshot(file);

  renderedAvatarDataUrl = rendered.dataUrl;
  renderedAvatarFileKey = key;
  copyCanvasToPreview(rendered.canvas);
  setPreviewLightboxSource(rendered.dataUrl);
  setAvatarStatus('MUGSHOT READY.', 'good');
  return rendered.dataUrl;
}

function resetJoinForm(form){
  form.reset();
  clearJoinFieldFlags();
  renderedAvatarDataUrl = '';
  renderedAvatarFileKey = '';
  setAvatarStatus('', '');
  paintEmptyAvatarPreview();
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('joinForm');
  const submitButton = document.getElementById('btnCreateAccount');
  const avatarInput = document.getElementById('joinAvatar');
  if(!form || !submitButton) return;

  paintEmptyAvatarPreview();

  if(!joinDb){
    submitButton.disabled = true;
    setJoinStatus('Booking desk is offline. Refresh and try again.', 'bad');
    return;
  }

  finishPendingJoinFromCurrentSession();
  joinDb.auth.onAuthStateChange((_event, session) => {
    finishPendingJoinForUser(session?.user);
  });

  // Once they start fixing it, stop shouting about it. Leaving the outline and
  // the old message up while the field is being retyped reads as if the new
  // value is wrong too.
  form.addEventListener('input', (event) => {
    if(!event.target.classList.contains('join-input-bad')) return;
    event.target.classList.remove('join-input-bad');
    setJoinStatus('', '');
  });

  if(avatarInput){
    avatarInput.addEventListener('change', async () => {
      const file = avatarInput.files?.[0] || null;
      renderedAvatarDataUrl = '';
      renderedAvatarFileKey = '';

      if(!file){
        setAvatarStatus('', '');
        paintEmptyAvatarPreview();
        return;
      }

      setAvatarStatus('Rendering mugshot...', '');
      try {
        await prepareAvatarUpload(file);
      } catch(error) {
        setAvatarStatus(error.message, 'bad');
        paintEmptyAvatarPreview();
      }
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const email = document.getElementById('joinEmail').value.trim();
    const username = document.getElementById('joinUsername').value.trim();
    const firstName = document.getElementById('joinFirstName').value.trim();
    const lastName = document.getElementById('joinLastName').value.trim();
    const password = document.getElementById('joinPassword').value;
    const passwordConfirm = document.getElementById('joinPasswordConfirm').value;
    const avatarFile = avatarInput?.files?.[0] || null;

    const problem = validateJoin({
      email,
      username,
      firstName,
      lastName,
      password,
      passwordConfirm
    });
    if(problem){
      setJoinStatus(problem.message, 'bad');
      flagJoinField(problem.fieldId);
      return;
    }

    clearJoinFieldFlags();

    submitButton.disabled = true;
    let avatarDataUrl = null;
    if(avatarFile){
      setJoinStatus('Rendering the mugshot...', '');
      try {
        avatarDataUrl = await prepareAvatarUpload(avatarFile);
      } catch(error) {
        setJoinStatus(error.message, 'bad');
        submitButton.disabled = false;
        return;
      }
    }

    const profileDetails = { email, username, firstName, lastName, avatarDataUrl };

    setJoinStatus('Filing the booking papers...', '');

    try {
      const signedInResult = await finishProfileForSignedInUser(profileDetails);
      if(signedInResult){
        if(signedInResult === 'redirect') redirectToSuspects();
        return;
      }

      // signUp is the Supabase method name; it is not ours to rename.
      const { data, error } = await joinDb.auth.signUp({
        email,
        password,
        options: {
          // The mugshot must NOT go in here. Everything in `data` becomes
          // user_metadata, which Supabase embeds in the JWT, which then rides
          // in the Authorization header of every authenticated request. A
          // 256px PNG data URL is around 234 KB — roughly 29x the ~8 KB header
          // limit — so the gateway rejects every request with a bodyless 400
          // "Bad Request" before PostgREST is ever reached, and the whole site
          // breaks for that account the moment it signs in. The mugshot lives
          // in ff_profiles.avatar_data_url, which is a column, not a header.
          data: {
            username,
            first_name: firstName,
            last_name: lastName
          },
          emailRedirectTo: joinRootUrl('suspects/index.html')
        }
      });

      if(error){
        // The raw error, verbatim: the friendly message below deliberately
        // collapses several causes into one sentence, and when that sentence
        // looks wrong this is the only way to see which cause actually fired.
        console.error('signUp error (raw):', {
          message: error.message,
          code: error.code,
          status: error.status,
          name: error.name
        });
        setJoinStatus(bookingErrorMessage(error), 'bad');
        return;
      }

      // With email confirmation switched on, Supabase will not admit that an
      // address is taken — it returns a normal-looking user with an empty
      // identities array and no error, so this is the only way to spot it.
      //
      // Only in that flow, though: the tell is a user with no session. This
      // project currently has confirmations off, where a real signup comes back
      // with a session attached, and treating an empty identities array as
      // "taken" there would reject brand new accounts.
      if(data?.user && !data?.session &&
         Array.isArray(data.user.identities) && data.user.identities.length === 0){
        setJoinStatus(EMAIL_TAKEN_MESSAGE, 'bad');
        return;
      }

      if(data?.user && data?.session){
        const { error: profileError } = await createProfileForSession(data.user, profileDetails);

        if(profileError){
          if(profileError.code === '23505'){
            setJoinStatus('That username is already booked. Try another handle.', 'bad');
          } else {
            setJoinStatus(`Account created, but profile booking failed: ${profileError.message}`, 'bad');
          }
          return;
        }

        setJoinStatus('Booking complete. Taking you to Suspects.', 'good');
        resetJoinForm(form);
        redirectToSuspects();
        return;
      }

      savePendingJoin(profileDetails);
      setJoinStatus('Booking filed. Check your email, then report to Suspects.', 'good');
      resetJoinForm(form);
      redirectToSuspects(1200);
    } catch(error) {
      console.error('Join error:', error);
      // Say what actually went wrong. A blanket "unexpected error" hid a real
      // bug here for as long as it was the message.
      setJoinStatus(bookingErrorMessage(error), 'bad');
    } finally {
      submitButton.disabled = false;
    }
  });
});
})();
