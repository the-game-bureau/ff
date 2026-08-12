const JOIN_SUPABASE_URL = 'https://qmaafbncpzrdmqapkkgr.supabase.co';
const JOIN_SUPABASE_ANON_KEY = 'sb_publishable_6a9XqxYa0-AZtyrwz4ZeUg_aiMsVH-3';
const JOIN_PROFILES_TABLE = 'ff_profiles';
const AVATAR_CANVAS_SIZE = 128;
const AVATAR_PROCESS_SIZE = 192;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const MUGSHOT_UPLOAD_SIZE = 1024;
const MUGSHOT_STORAGE_SIZE = 256;
// Mugshots are photographs, which PNG stores badly — the same 256px image is
// roughly 12x smaller as JPEG. Every stored mugshot is fetched again for each
// player in the lineup, so the saving is per row, per visitor. Both mugshot
// canvases paint an opaque white ground first, so there is no transparency for
// JPEG to lose. 0.82 is the usual sweet spot before artefacts show on faces.
const MUGSHOT_JPEG_TYPE = 'image/jpeg';
const MUGSHOT_JPEG_QUALITY = 0.82;
const MUGSHOT_AI_TIMEOUT_MS = 70000;
const MUGSHOT_AI_ENABLED = false;
const MUGSHOT_FUNCTION_URL = `${JOIN_SUPABASE_URL}/functions/v1/ff-mugshotify`;
const DEFAULT_MUGSHOT_URL = new URL('../src/generated/mugshot-placeholder.svg', window.location.href).href;

let renderedAvatarDataUrl = '';
let renderedAvatarFileKey = '';

const joinDb = window.supabase ? window.supabase.createClient(JOIN_SUPABASE_URL, JOIN_SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    storageKey: 'law-order-svu-auth-qmaafbncpzrdmqapkkgr',
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
    window.location.href = new URL('../suspects/index.html', window.location.href).href;
  }, delay);
}

function validateJoin({ email, username, firstName, lastName, password, passwordConfirm, bailPaid }){
  if(!email || !username || !firstName || !lastName || !password || !passwordConfirm){
    return 'Fill every required booking field.';
  }

  // An attestation, not a receipt: nothing here can see Venmo. It is checked
  // first so a player who has not paid is told that before filling anything
  // else in, rather than after.
  if(!bailPaid){
    return 'Bail is $5 to @KevinMKolb on Venmo. Send it, then tick the box to confirm.';
  }

  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    return 'Enter a valid email address.';
  }

  if(!/^[a-zA-Z0-9_]{3,20}$/.test(username)){
    return 'Username must be 3-20 characters, letters/numbers/underscore only.';
  }

  if(firstName.length > 50 || lastName.length > 50){
    return 'First and last names must be 50 characters or fewer.';
  }

  if(password.length < 6){
    return 'Password must be at least 6 characters.';
  }

  if(password !== passwordConfirm){
    return 'Password confirmation does not match.';
  }

  return '';
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

function clampByte(value){
  return Math.max(0, Math.min(255, Math.round(value)));
}

function posterizeChannel(value, levels = 9){
  const step = 255 / (levels - 1);
  return clampByte(Math.round(value / step) * step);
}

function luminanceAt(pixels, width, height, x, y){
  const safeX = Math.max(0, Math.min(width - 1, x));
  const safeY = Math.max(0, Math.min(height - 1, y));
  const i = (safeY * width + safeX) * 4;
  return pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
}

function edgeStrengthAt(pixels, width, height, x, y){
  const tl = luminanceAt(pixels, width, height, x - 1, y - 1);
  const tc = luminanceAt(pixels, width, height, x, y - 1);
  const tr = luminanceAt(pixels, width, height, x + 1, y - 1);
  const ml = luminanceAt(pixels, width, height, x - 1, y);
  const mr = luminanceAt(pixels, width, height, x + 1, y);
  const bl = luminanceAt(pixels, width, height, x - 1, y + 1);
  const bc = luminanceAt(pixels, width, height, x, y + 1);
  const br = luminanceAt(pixels, width, height, x + 1, y + 1);
  const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
  const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
  return Math.sqrt(gx * gx + gy * gy);
}

function smoothPreservingEdges(pixels, width, height, passes = 2){
  const kernel = [
    [-1, -1, 1], [0, -1, 2], [1, -1, 1],
    [-1, 0, 2],  [0, 0, 5],  [1, 0, 2],
    [-1, 1, 1],  [0, 1, 2],  [1, 1, 1]
  ];
  let source = new Uint8ClampedArray(pixels);

  for(let pass = 0; pass < passes; pass++){
    const output = new Uint8ClampedArray(source.length);

    for(let y = 0; y < height; y++){
      for(let x = 0; x < width; x++){
        const i = (y * width + x) * 4;
        const centerR = source[i];
        const centerG = source[i + 1];
        const centerB = source[i + 2];
        let r = 0;
        let g = 0;
        let b = 0;
        let total = 0;

        for(const [dx, dy, baseWeight] of kernel){
          const sampleX = Math.max(0, Math.min(width - 1, x + dx));
          const sampleY = Math.max(0, Math.min(height - 1, y + dy));
          const sampleIndex = (sampleY * width + sampleX) * 4;
          const colorDelta =
            (Math.abs(source[sampleIndex] - centerR) +
             Math.abs(source[sampleIndex + 1] - centerG) +
             Math.abs(source[sampleIndex + 2] - centerB)) / 3;
          const colorWeight = Math.max(0.12, 1 - colorDelta / 96);
          const weight = baseWeight * colorWeight;

          r += source[sampleIndex] * weight;
          g += source[sampleIndex + 1] * weight;
          b += source[sampleIndex + 2] * weight;
          total += weight;
        }

        output[i] = r / total;
        output[i + 1] = g / total;
        output[i + 2] = b / total;
        output[i + 3] = 255;
      }
    }

    source = output;
  }

  return source;
}

function tuneCartoonColor(channel, average){
  const contrast = (channel - 128) * 1.04 + 128;
  const saturated = average + (contrast - average) * 1.18;
  const lifted = saturated + (average > 210 ? 4 : average < 64 ? -6 : 2);
  return posterizeChannel(lifted, average > 92 && average < 210 ? 10 : 8);
}

function cartoonizeImageData(imageData){
  const { width, height, data } = imageData;
  const original = new Uint8ClampedArray(data);
  const smoothed = smoothPreservingEdges(original, width, height, 2);

  for(let y = 0; y < height; y++){
    for(let x = 0; x < width; x++){
      const i = (y * width + x) * 4;
      const alpha = original[i + 3];

      if(alpha < 32){
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = 255;
        continue;
      }

      const average = (smoothed[i] + smoothed[i + 1] + smoothed[i + 2]) / 3;
      let r = tuneCartoonColor(smoothed[i], average);
      let g = tuneCartoonColor(smoothed[i + 1], average);
      let b = tuneCartoonColor(smoothed[i + 2], average);
      const edge = edgeStrengthAt(original, width, height, x, y);
      const outline = Math.pow(Math.max(0, Math.min(1, (edge - 46) / 148)), 0.8) * 0.72;

      if(outline > 0){
        const ink = 18;
        r = clampByte(r * (1 - outline) + ink * outline);
        g = clampByte(g * (1 - outline) + ink * outline);
        b = clampByte(b * (1 - outline) + ink * outline);
      }

      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }

  return imageData;
}

function paintEmptyAvatarPreview(){
  const canvas = document.getElementById('avatarPreviewCanvas');
  const previewButton = document.getElementById('avatarPreviewButton');
  if(!canvas) return;

  if(previewButton) previewButton.dataset.mugshotSrc = DEFAULT_MUGSHOT_URL;

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
  placeholder.src = DEFAULT_MUGSHOT_URL;
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

  previewButton.dataset.mugshotSrc = dataUrl || DEFAULT_MUGSHOT_URL;
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

async function fileToSquareDataUrl(file, outputSize, type = 'image/jpeg', quality = 0.86){
  validateMugshotFile(file);

  const image = await loadImageFromFile(file);
  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, outputSize, outputSize);
  drawImageToSquare(ctx, image, outputSize);

  return canvas.toDataURL(type, quality);
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

async function normalizeGeneratedMugshot(dataUrl){
  if(!/^data:image\/(?:png|jpe?g|webp);base64,/i.test(String(dataUrl || ''))){
    throw new Error('AI mugshot response was not an image.');
  }

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
    dataUrl: canvas.toDataURL(MUGSHOT_JPEG_TYPE, MUGSHOT_JPEG_QUALITY)
  };
}

function fetchWithTimeout(url, options, timeoutMs){
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, {
    ...options,
    signal: controller.signal
  }).finally(() => window.clearTimeout(timeoutId));
}

async function getMugshotFunctionAuthToken(){
  const { data } = await joinDb.auth.getSession();
  return data?.session?.access_token || JOIN_SUPABASE_ANON_KEY;
}

async function renderAiMugshot(file){
  validateMugshotFile(file);

  const imageDataUrl = await fileToSquareDataUrl(file, MUGSHOT_UPLOAD_SIZE);
  const authToken = await getMugshotFunctionAuthToken();

  const response = await fetchWithTimeout(MUGSHOT_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': JOIN_SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify({ imageDataUrl })
  }, MUGSHOT_AI_TIMEOUT_MS);

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    throw new Error('AI mugshot response was unreadable.');
  }

  if(!response.ok){
    throw new Error(payload?.error || 'AI mugshot conversion failed.');
  }

  return await normalizeGeneratedMugshot(payload?.dataUrl);
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

async function renderCartoonMugshot(file){
  validateMugshotFile(file);

  const image = await loadImageFromFile(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const cropSize = Math.min(sourceWidth, sourceHeight);
  const cropX = Math.floor((sourceWidth - cropSize) / 2);
  const cropY = Math.floor((sourceHeight - cropSize) / 2);

  const processCanvas = document.createElement('canvas');
  processCanvas.width = AVATAR_PROCESS_SIZE;
  processCanvas.height = AVATAR_PROCESS_SIZE;
  const processCtx = processCanvas.getContext('2d', { willReadFrequently: true });
  processCtx.imageSmoothingEnabled = true;
  processCtx.imageSmoothingQuality = 'high';
  processCtx.fillStyle = '#FFFFFF';
  processCtx.fillRect(0, 0, AVATAR_PROCESS_SIZE, AVATAR_PROCESS_SIZE);
  processCtx.drawImage(
    image,
    cropX,
    cropY,
    cropSize,
    cropSize,
    0,
    0,
    AVATAR_PROCESS_SIZE,
    AVATAR_PROCESS_SIZE
  );

  const imageData = processCtx.getImageData(0, 0, AVATAR_PROCESS_SIZE, AVATAR_PROCESS_SIZE);
  processCtx.putImageData(cartoonizeImageData(imageData), 0, 0);

  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_CANVAS_SIZE;
  canvas.height = AVATAR_CANVAS_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, AVATAR_CANVAS_SIZE, AVATAR_CANVAS_SIZE);
  ctx.drawImage(processCanvas, 0, 0, AVATAR_CANVAS_SIZE, AVATAR_CANVAS_SIZE);

  return {
    canvas,
    dataUrl: canvas.toDataURL(MUGSHOT_JPEG_TYPE, MUGSHOT_JPEG_QUALITY)
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

  let rendered;
  let renderedMode = 'raw';

  if(MUGSHOT_AI_ENABLED){
    try {
      renderedMode = 'ai';
      setAvatarStatus('Sketch artist drawing...', '');
      rendered = await renderAiMugshot(file);
    } catch(error) {
      console.warn('AI mugshot conversion failed. Falling back to resized raw upload:', error);
      renderedMode = 'raw';
    }
  }

  if(!rendered){
    setAvatarStatus('Sizing mugshot...', '');
    rendered = await renderRawMugshot(file);
  }

  renderedAvatarDataUrl = rendered.dataUrl;
  renderedAvatarFileKey = key;
  copyCanvasToPreview(rendered.canvas);
  setPreviewLightboxSource(rendered.dataUrl);
  // Same message either way: whether the AI pass ran or the photo went through
  // as-is is our business, not the player's.
  setAvatarStatus('MUGSHOT READY.', 'good');
  return rendered.dataUrl;
}

function resetJoinForm(form){
  form.reset();
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
    const bailPaid = Boolean(document.getElementById('joinBailPaid')?.checked);
    const avatarFile = avatarInput?.files?.[0] || null;

    const validationError = validateJoin({
      email,
      username,
      firstName,
      lastName,
      password,
      passwordConfirm,
      bailPaid
    });
    if(validationError){
      setJoinStatus(validationError, 'bad');
      return;
    }

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
          emailRedirectTo: new URL('../suspects/index.html', window.location.href).href
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
