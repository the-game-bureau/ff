// ===== JOIN POPUP =====
// The booking form as a lightbox, so JOIN never navigates away from whatever
// somebody was reading. Every other popup on this site works this way — sign
// in, welcome, the mugshot viewer — and the join form was the last thing that
// still took over the page.
//
// The markup here is the same form as join/index.html, ids and all, and
// js/join.js binds to whichever copy is present. That is also why this file
// stands down entirely when a #joinForm already exists: on the join page the
// form is in the markup, so injecting a second one would duplicate every id and
// leave js/join.js wiring the wrong fields.
//
// Loaded before js/join.js on purpose. Both act on DOMContentLoaded, and the
// form has to be in the DOM before join.js goes looking for it.
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

        <!-- novalidate matches join/index.html: validateJoin() in js/join.js
             names the broken rule, the browser's bubble does not. -->
        <form class="join-form" id="joinForm" novalidate>
          <div class="join-field">
            <label for="joinUsername">Username / Team Name <span class="privacy-tag privacy-tag-public">Public</span></label>
            <input id="joinUsername" name="username" type="text" autocomplete="nickname" minlength="3" maxlength="20" pattern="[A-Za-z0-9_]{3,20}" required/>
            <p class="gate-help">3-20 characters. Letters, numbers, and underscores only &mdash; no spaces, no punctuation. This is the name on your mugshot placard and in every verdict.</p>
          </div>

          <div class="join-field avatar-field">
            <label for="joinAvatar">Mugshot <span class="privacy-tag privacy-tag-public">Public</span> <span class="privacy-tag">Not Mandatory</span></label>
            <div class="avatar-upload-row">
              <div class="avatar-preview-frame">
                <button id="avatarPreviewButton" class="avatar-preview-button" type="button" data-mugshot-lightbox data-mugshot-alt="Mugshot preview" aria-label="Mugshot preview">
                  <canvas id="avatarPreviewCanvas" class="avatar-preview" width="96" height="96" aria-label="Mugshot preview"></canvas>
                </button>
              </div>
              <div class="avatar-upload-control">
                <input id="joinAvatar" name="mugshot" type="file" accept="image/*"/>
                <div id="avatarStatus" class="avatar-status" aria-live="polite"></div>
              </div>
            </div>
          </div>

          <div class="join-field">
            <label for="joinFirstName">First Name <span class="privacy-tag privacy-tag-players">Seen by Players Only</span></label>
            <input id="joinFirstName" name="first_name" type="text" autocomplete="given-name" required/>
          </div>

          <div class="join-field">
            <label for="joinLastName">Last Name <span class="privacy-tag">Private</span></label>
            <input id="joinLastName" name="last_name" type="text" autocomplete="family-name" required/>
          </div>

          <div class="join-field">
            <label for="joinEmail">Email <span class="privacy-tag">Private</span></label>
            <input id="joinEmail" name="email" type="email" autocomplete="email" required/>
          </div>

          <div class="join-field">
            <label for="joinPassword">Password <span class="privacy-tag">Private Obviously</span></label>
            <input id="joinPassword" name="password" type="password" autocomplete="new-password" minlength="6" required/>
            <p class="gate-help">At least 6 characters.</p>
          </div>

          <div class="join-field">
            <label for="joinPasswordConfirm">Confirm Password <span class="privacy-tag">Private Obviously</span></label>
            <input id="joinPasswordConfirm" name="password_confirm" type="password" autocomplete="new-password" minlength="6" required/>
          </div>

          <div class="action-buttons join-actions">
            <button id="btnCreateAccount" class="btn btn-primary" type="submit">Join</button>
          </div>

          <div id="joinStatus" class="join-status" role="status" aria-live="polite"></div>
        </form>
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

    modal.hidden = false;
    document.getElementById('joinUsername')?.focus();
  }

  function closeJoinModal() {
    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.hidden = true;
  }

  // For scripts that want the form without faking a click on a link.
  window.openJoinModal = openJoinModal;
})();
