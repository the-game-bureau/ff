// ===== THE BOOKING FORM, WRITTEN ONCE =====
// The Person of Interest form appears in two places: inline on
// join/index.html, and inside the popup js/join-modal.js builds on every other
// page. It used to be two copies of the same markup in two files, which drifted
// exactly the way two copies do - the page learned that a username is "visible
// to the world" and that the email address is how you sign in, and the popup,
// which is the copy most people actually meet, kept saying something else.
//
// So the markup lives here and both callers ask for it. js/join.js binds to
// whichever copy is on the page by id, as it always has.
//
// Loaded before js/join-modal.js and js/join.js on purpose: all three act on
// DOMContentLoaded and handlers run in the order they were registered, so the
// form has to be in the DOM before the popup checks whether it exists and
// before join.js goes looking for its fields.
(function () {
  const FORM_CONFIG = window.FF_SUPABASE_CONFIG || {};
  const PASSWORD_MIN_LENGTH = FORM_CONFIG.passwordMinLength || 8;

  // novalidate on purpose: the browser's "Please match the requested format"
  // bubble on the username pattern names no rule. validateJoin() in js/join.js
  // does the checking and says which one was broken.
  function joinFormHtml() {
    return `
      <form class="join-form" id="joinForm" novalidate>
        <div class="join-field">
          <label for="joinUsername">Username / Team Name <span class="privacy-tag privacy-tag-public">Public</span></label>
          <input id="joinUsername" name="username" type="text" autocomplete="nickname" minlength="3" maxlength="20" pattern="[A-Za-z0-9_]{3,20}" required/>
          <p class="gate-help">3-20 characters. Letters, numbers, and underscores only - no spaces, no punctuation. This is the name on your mugshot placard visible to the world.</p>
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
          <p class="gate-help">This is how you sign in. Your username is the name on your placard, not a login.</p>
        </div>

        <div class="join-field">
          <label for="joinPassword">Password <span class="privacy-tag">Private Obviously</span></label>
          <input id="joinPassword" name="password" type="password" autocomplete="new-password" minlength="${PASSWORD_MIN_LENGTH}" required/>
          <p class="gate-help">At least ${PASSWORD_MIN_LENGTH} characters.</p>
        </div>

        <div class="join-field">
          <label for="joinPasswordConfirm">Confirm Password <span class="privacy-tag">Private Obviously</span></label>
          <input id="joinPasswordConfirm" name="password_confirm" type="password" autocomplete="new-password" minlength="${PASSWORD_MIN_LENGTH}" required/>
        </div>

        <div class="action-buttons join-actions">
          <button id="btnCreateAccount" class="btn btn-primary" type="submit">Join</button>
        </div>

        <!-- Forwarded links land here, so some of the people reading it already
             have an account and only need the door. href="#signin" is the
             site's own way in to Identify Yourself. -->
        <a class="alt-action-link" href="#signin">Already joined? Click here to login.</a>

        <div id="joinStatus" class="join-status" role="status" aria-live="polite"></div>
      </form>
    `;
  }

  window.ffJoinFormHtml = joinFormHtml;

  // The join page mounts it inline. Everywhere else there is no mount and the
  // popup asks for the markup itself when it builds.
  document.addEventListener('DOMContentLoaded', () => {
    const mount = document.getElementById('joinFormMount');
    if (!mount || document.getElementById('joinForm')) return;
    mount.innerHTML = joinFormHtml();
  });
})();
