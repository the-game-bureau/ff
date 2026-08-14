// Change your own mugshot from the lineup.
//
// The photo used to be settable once, at booking, and after that the only way
// to replace it was to go back through the join form. This puts a REPHOTOGRAPH
// button on one card and one card only: yours. Everybody else's is read-only,
// and that is enforced twice — this script never offers the control on another
// card, and supabase/sql/ff_own_mugshot_only.sql restricts the UPDATE to the
// signed-in user's own row and to the mugshot column alone, so a hand-written
// request cannot repaint someone else's file either.
(function () {
  const PROFILES_TABLE = window.FF_SUPABASE_CONFIG?.tables?.profiles || 'ff_profiles';
  const MAX_BYTES = 5 * 1024 * 1024;
  // Same 256px JPEG the join form stores, so a replacement is the same weight
  // as the original. The pipeline is duplicated from renderRawMugshot() in
  // js/join.js rather than shared: join.js is one page's script from top to
  // bottom, and pulling the canvas work out of it is a bigger change than this
  // feature justifies. If a third caller ever needs it, extract it then.
  const STORAGE_SIZE = 256;
  const JPEG_QUALITY = 0.88;

  let picker = null;
  let busy = false;

  document.addEventListener('DOMContentLoaded', () => {
    // Delegated: the lineup re-renders on every auth change, so binding to the
    // button itself would go stale.
    document.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-mugshot-edit]');
      if (!trigger) return;
      event.preventDefault();
      openPicker();
    });
  });

  function db() {
    return typeof suspectsDb !== 'undefined' ? suspectsDb : null;
  }

  function status(message, kind) {
    if (typeof setSuspectsStatus === 'function') setSuspectsStatus(message, kind);
  }

  function openPicker() {
    if (busy) return;

    if (!picker) {
      picker = document.createElement('input');
      picker.type = 'file';
      picker.accept = 'image/*';
      picker.style.display = 'none';
      picker.addEventListener('change', () => {
        const file = picker.files?.[0];
        // Cleared so choosing the same file twice still fires a change event —
        // a retry after a failed save is the obvious case.
        picker.value = '';
        if (file) saveMugshot(file);
      });
      document.body.appendChild(picker);
    }

    picker.click();
  }

  async function saveMugshot(file) {
    const client = db();
    if (!client) {
      status('Booking desk is offline. Refresh and try again.', 'bad');
      return;
    }

    busy = true;

    try {
      validate(file);
      status('Sizing mugshot...', '');
      const dataUrl = await fileToMugshotDataUrl(file);

      const { data: { user } } = await client.auth.getUser();
      if (!user) {
        status('Sign in before changing your mugshot.', 'bad');
        return;
      }

      // Scoped to the caller's own id. The row-level policy says the same
      // thing; this is here so a mistake shows up as zero rows changed rather
      // than as somebody else's card.
      const { error } = await client
        .from(PROFILES_TABLE)
        .update({ avatar_data_url: dataUrl })
        .eq('id', user.id);

      if (error) {
        status(`Mugshot save failed: ${error.message}`, 'bad');
        return;
      }

      status('New mugshot on file.', 'good');
      if (typeof loadCurrentSuspects === 'function') await loadCurrentSuspects();
    } catch (error) {
      status(error?.message || 'Mugshot could not be read.', 'bad');
    } finally {
      busy = false;
    }
  }

  function validate(file) {
    if (!file.type || !file.type.startsWith('image/')) {
      throw new Error('Mugshot must be an image file.');
    }
    if (file.size > MAX_BYTES) {
      throw new Error('Mugshot image must be 5 MB or smaller.');
    }
  }

  // Centre-cropped to a square and flattened onto white, so a transparent PNG
  // doesn't come out as a black tile on the placard.
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
})();
