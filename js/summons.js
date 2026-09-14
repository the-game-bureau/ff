// ===== SUMMONS =====
// A summons is the instrument that compels somebody to appear, which is exactly
// what handing them this link does - so the share sheet is a summons, and the
// button that opens it says so. The wording is not new: the sheet has been
// headed "Issue a Summons" since it was built, and this puts the same word in
// the header of every page rather than only under the Precinct's QR code.
//
// THE ONE COPY OF THE MARKUP
// Built here and nowhere else. index.html used to carry the share sheet inline,
// which was fine while the Precinct was the only page that could open it; the
// moment every page needs one, a hand-maintained copy per page is six copies to
// drift. Same reasoning as js/join-form.js, which exists for the same reason.
//
// js/share.js drives it. This file only builds the markup and the button; every
// decision about what gets shared, on which platform, in what order, stays in
// the one place that already makes them.
(function () {
  // Where the QR and the logo live, relative to the page asking. The nav mount
  // already carries this for the same reason, so it is read from there rather
  // than guessed from the URL - a page moved into a folder should only have to
  // say so once.
  function prefix() {
    const mount = document.getElementById('siteNav');
    return mount?.dataset.prefix || '';
  }

  document.addEventListener('DOMContentLoaded', () => {
    ensureButton();
    ensureModal();
  });

  // Upper right, to the left of Escape / Login. Inserted at the front of the
  // row rather than appended, so it keeps that position whichever of the two
  // auth controls is showing - they swap places as somebody signs in and out.
  function ensureButton() {
    if (document.getElementById('btnSummons')) return;

    // js/auth-corner.js builds this corner on DOMContentLoaded too. Whichever
    // of us runs second finds it; whoever runs first waits a tick for it.
    const row = document.querySelector('.header-corner .header-user-row');
    if (!row) {
      window.setTimeout(ensureButton, 0);
      return;
    }

    const stack = document.createElement('span');
    stack.className = 'header-id header-id-summons';

    const badge = document.createElement('span');
    badge.className = 'header-id-badge header-id-badge-single';

    const button = document.createElement('button');
    button.id = 'btnSummons';
    button.className = 'header-id-escape';
    button.type = 'button';
    button.textContent = 'Summons';
    button.title = 'Hand this game to somebody else';

    badge.appendChild(button);
    stack.appendChild(badge);
    row.insertBefore(stack, row.firstChild);
  }

  // The Precinct's body, in a popup: the code to point a camera at, and the
  // ways to send the same link to somebody who is not in the room.
  function ensureModal() {
    if (document.getElementById('shareModal')) return;

    const root = prefix();
    const modal = document.createElement('div');
    modal.id = 'shareModal';
    modal.className = 'modal-backdrop';
    modal.hidden = true;

    modal.innerHTML = `
      <div class="modal-card summons-card" role="dialog" aria-modal="true" aria-labelledby="shareTitle">
        <button class="modal-close" id="btnCloseShare" type="button" aria-label="Close">&times;</button>
        <h2 id="shareTitle">Issue a Summons</h2>

        <!-- Directly under the title, and the only place the address appears.
             It used to be printed twice - once as a chip under the code and
             again below the buttons - which read as two different links. -->
        <p class="share-url" id="shareUrl"></p>

        <div class="summons-qr">
          <!-- Not a link. It is meant to be pointed at with somebody else's
               camera, and tapping it on the device already showing it does
               nothing useful. -->
          <span class="qr-code">
            <img src="${root}src/qr-welcome.svg" width="200" height="200" draggable="false"
                 alt="QR code linking to thegamebureau.com/ff"/>
          </span>
        </div>

        <p class="qr-caption">Have them scan this, or use these options:</p>

        <div class="share-actions">
          <button id="btnShareNative" class="btn btn-primary" type="button" hidden>Share&hellip;</button>
          <button id="btnShareCopy" class="btn btn-secondary" type="button">Copy Link</button>
          <a id="btnShareEmail" class="btn btn-secondary" href="#">Email</a>
        </div>

        <div id="shareStatus" class="field-error" role="status" aria-live="polite"></div>
      </div>`;

    document.body.appendChild(modal);
  }
})();
