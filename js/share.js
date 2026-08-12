// ===== SHARE SHEET =====
// Backs the "Other Ways to Share" button under the QR code. Same destination
// the QR encodes, so however someone passes the game along they land on the
// squad room with the sign-in window already open.
(function () {
  // What actually gets shared: the trailing "#welcome" opens the introduction
  // on arrival, so every copy/email/native share carries it. People reaching
  // this link have been handed it by a friend and know nothing about the game.
  const SHARE_URL = 'https://thegamebureau.com/ff/#welcome';
  // What gets shown. The fragment is machinery and the scheme is noise; the
  // short form is what people read out loud, and it matches the QR chip.
  const SHARE_URL_DISPLAY = 'thegamebureau.com/ff';
  const COPY_LABEL = 'Copy Link';
  const COPY_DONE_LABEL = 'Link Copied to Clipboard';
  const SHARE_TITLE = 'Law & Order: Special Victory Unit';
  // Goes to every channel that carries more than a bare link: email body, text
  // message, and the OS share sheet. Copy Link stays the URL alone.
  const SHARE_TEXT = 'Join me in playing the strangest fantasy football game you\'ve ever seen. DUN DUN.';

  document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('shareModal');
    const openBtn = document.getElementById('btnOtherShare');
    if (!modal || !openBtn) return;

    const closeBtn = document.getElementById('btnCloseShare');
    const nativeBtn = document.getElementById('btnShareNative');
    const copyBtn = document.getElementById('btnShareCopy');
    const emailLink = document.getElementById('btnShareEmail');
    const urlEl = document.getElementById('shareUrl');
    const statusEl = document.getElementById('shareStatus');

    if (urlEl) urlEl.textContent = SHARE_URL_DISPLAY;

    // iPadOS 13+ reports itself as a Mac, so touch points are what separate an
    // iPad from a desktop Safari.
    const ua = navigator.userAgent || '';
    const isIOS = /iP(hone|ad|od)/.test(ua) ||
      (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/.test(ua);
    const isMobile = isIOS || isAndroid;

    const body = `${SHARE_TEXT}\n\n${SHARE_URL}`;
    if (emailLink) {
      emailLink.href = `mailto:?subject=${encodeURIComponent(SHARE_TITLE)}&body=${encodeURIComponent(body)}`;
    }

    // The OS share sheet is a phone affordance. Chrome and Edge on Windows do
    // implement navigator.share, but it opens the Windows share flyout, which
    // is not what anyone expects from a web page, so desktop skips it.
    const nativeAvailable = isMobile && Boolean(navigator.share);
    if (nativeBtn && nativeAvailable) {
      nativeBtn.addEventListener('click', async () => {
        try {
          await navigator.share({ title: SHARE_TITLE, text: SHARE_TEXT, url: SHARE_URL });
        } catch (error) {
          // Cancelling the sheet rejects; that is not worth reporting.
          if (error?.name !== 'AbortError') setStatus('Could not open the share sheet.', true);
        }
      });
    }

    // Each platform gets its own lineup, in its own order. A phone leads with
    // the OS sheet, which already reaches Messages and Mail, so no row here
    // duplicates it. A desktop has no sheet worth opening, so it gets the two
    // channels that work there: email, then the link.
    const lineup = (isMobile
      ? [nativeAvailable ? nativeBtn : null, copyBtn]
      : [emailLink, copyBtn]
    ).filter(Boolean);

    // Everything starts hidden so a button missing from this platform's lineup
    // stays out, then the survivors are re-appended in lineup order.
    for (const el of [nativeBtn, copyBtn, emailLink]) {
      if (el) el.hidden = true;
    }

    const actionRow = document.querySelector('.share-actions');
    lineup.forEach((el, index) => {
      el.hidden = false;
      actionRow?.appendChild(el);
      // Whichever ends up on top carries the primary colour.
      el.classList.toggle('btn-primary', index === 0);
      el.classList.toggle('btn-secondary', index !== 0);
    });

    // The button reports its own result instead of a separate status line. It
    // stays live afterwards, so clicking it again copies again.
    copyBtn?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(SHARE_URL);
        copyBtn.textContent = COPY_DONE_LABEL;
        setStatus('', false);
      } catch (error) {
        // Clipboard access needs a secure context and can be blocked outright.
        // Back to the plain label: nothing was copied.
        copyBtn.textContent = COPY_LABEL;
        setStatus('Copy blocked — select the link below instead.', true);
      }
    });

    openBtn.addEventListener('click', () => {
      setStatus('', false);
      // A fresh open starts from the plain label; the "copied" state belongs to
      // the visit that did the copying.
      if (copyBtn) copyBtn.textContent = COPY_LABEL;
      modal.hidden = false;
    });

    closeBtn?.addEventListener('click', () => { modal.hidden = true; });

    modal.addEventListener('click', (event) => {
      if (event.target === modal) modal.hidden = true;
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.hidden) modal.hidden = true;
    });

    function setStatus(message, isError) {
      if (!statusEl) return;
      statusEl.textContent = message;
      statusEl.style.color = isError ? 'var(--error)' : 'var(--success)';
    }
  });
})();
