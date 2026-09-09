// ===== JOIN POPUP =====
// The booking form as a lightbox, so JOIN never navigates away from whatever
// somebody was reading. Every other popup on this site works this way - sign
// in, welcome, the mugshot viewer - and the join form was the last thing that
// still took over the page.
//
// The form itself comes from js/join-form.js, which is the one copy of that
// markup on the site; js/join.js binds to whichever copy is on the page. That
// is also why this file stands down entirely when a #joinForm already exists:
// on the join page the form is mounted inline, and injecting a second one would
// duplicate every id and leave js/join.js wiring the wrong fields.
//
// Loaded after js/join-form.js and before js/join.js on purpose. All three act
// on DOMContentLoaded, and the form has to exist before this checks for it and
// before join.js goes looking for its fields.
(function () {
  const MODAL_ID = 'joinModal';

  document.addEventListener('DOMContentLoaded', () => {
    // The join page itself. Nothing to pop up.
    if (document.getElementById('joinForm')) return;

    buildModal();

    // Delegated, because most of these links do not exist yet at this point:
    // the sign-in modal's Join button is built by auth-corner.js, and the
    // welcome card is built on demand. Anything pointing at the join page is
    // treated as a request to open the form, wherever it came from.
    document.addEventListener('click', (event) => {
      const trigger = event.target.closest('a[href$="join/index.html"], a[href="#join"]');
      if (!trigger) return;

      event.preventDefault();
      openJoinModal();
    });
  });

  function buildModal() {
    if (document.getElementById(MODAL_ID)) return;

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'modal-backdrop';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="modal-card join-card" role="dialog" aria-modal="true"
           aria-labelledby="joinModalTitle">
        <button class="modal-close" id="btnCloseJoin" type="button" aria-label="Close">&times;</button>

        <h2 id="joinModalTitle">Person of Interest</h2>

        ${window.ffJoinFormHtml ? window.ffJoinFormHtml() : ""}
      </div>`;

    document.body.appendChild(modal);

    document.getElementById('btnCloseJoin')?.addEventListener('click', closeJoinModal);

    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeJoinModal();
    });

    // Only this popup, and only when it is the one on top: the mugshot preview
    // opens a lightbox from inside the form, and Escape there should close the
    // lightbox rather than throw away a half-filled booking.
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || modal.hidden) return;
      if (document.body.classList.contains('mugshot-lightbox-open')) return;
      closeJoinModal();
    });
  }

  function openJoinModal() {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;

    // Whatever else is open gave way to this. The sign-in popup in particular
    // is where most Join clicks come from, and leaving it stacked underneath
    // would put two dialogs on screen at once.
    document.getElementById('signInModal')?.setAttribute('hidden', '');
    document.getElementById('welcomeModal')?.setAttribute('hidden', '');

    // Whatever was typed into the sign-in box on the way here. Called at open
    // time rather than at build time because on this route the form was built
    // before there was anything to carry: see js/join-prefill.js.
    window.ffApplyJoinPrefill?.();

    modal.hidden = false;
    document.getElementById('joinUsername')?.focus();
  }

  // The form carries "Already joined? Click here to login." now, and the
  // handler that answers it lives on the document. Left alone, Identify
  // Yourself would open with this still on top of it.
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#joinModal a[href="#signin"]')) return;
    closeJoinModal();
  });

  function closeJoinModal() {
    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.hidden = true;
  }

  // For scripts that want the form without faking a click on a link.
  window.openJoinModal = openJoinModal;
})();
