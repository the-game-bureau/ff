// ===== WELCOME =====
// What a stranger sees first. The QR code and every shared link point at
// /#welcome, so this is the landing mat for anyone arriving from a text, an
// email, or someone's phone screen — people who have no idea what this is.
//
// Two ways out, and neither is a dead end: BROWSE just closes it and leaves
// them on the site, JOIN hands off to the Identify Yourself popup, which is
// where both signing in and joining already live.
(function () {
  const WELCOME_HASH = '#welcome';

  // Two ways in, both of them a link someone chose to follow: arriving on
  // /#welcome (the QR code, a shared link), or clicking an href="#welcome"
  // anywhere on the site. Nothing opens this on its own.
  document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('click', (event) => {
      const trigger = event.target.closest('a[href="#welcome"]');
      if (!trigger) return;
      event.preventDefault();
      ensureWelcomeModal();
      openWelcome();
    });

    if (window.location.hash !== WELCOME_HASH) return;

    ensureWelcomeModal();
    openWelcome();
  });

  function ensureWelcomeModal() {
    if (document.getElementById('welcomeModal')) return;

    const modal = document.createElement('div');
    modal.id = 'welcomeModal';
    modal.className = 'modal-backdrop';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="modal-card welcome-card" role="dialog" aria-modal="true"
           aria-labelledby="welcomeTitle" tabindex="-1">
        <button class="modal-close" id="btnCloseWelcome" type="button" aria-label="Close">&times;</button>

        <h2 id="welcomeTitle">You&rsquo;ve Been Summoned</h2>

        <!-- Rewrites the show's cold open ("In the criminal justice system...")
             for fantasy football. -->
        <p class="welcome-lede">
          In the fantasy football system, there is no stranger or simpler
          version than the Special Victory Unit.
        </p>

        <!-- The vocabulary earns its keep here: "victim" is taught by
             apposition on first use, and elimination is phrased as the case
             closing, which is the same language the game-over card uses. -->
        <ul class="welcome-facts">
          <li>Each week you name a <strong>victim</strong> &mdash; one NFL team
            you suspect will lose. That&rsquo;s it.</li>
          <li>If your victim goes down then you keep playing. If they win, the
            case closes on you. <strong>Dun dun.</strong></li>
          <li>You can only name a victim once per season.</li>
          <li>It&rsquo;s <strong>free</strong>. No buy-in, no pot, nothing to
            pay.</li>
        </ul>


        <div class="modal-actions welcome-actions">
          <button id="btnWelcomeJoin" class="btn btn-secondary" type="button">Join</button>
          <button id="btnWelcomeBrowse" class="btn btn-secondary" type="button">Investigate</button>
        </div>
      </div>
    `;

    const nav = document.getElementById('siteNav');
    if (nav) {
      nav.insertAdjacentElement('afterend', modal);
    } else {
      document.body.appendChild(modal);
    }

    document.getElementById('btnCloseWelcome')?.addEventListener('click', closeWelcome);
    document.getElementById('btnWelcomeBrowse')?.addEventListener('click', closeWelcome);
    // Straight to the booking form, as a popup in place of this one. It used to
    // open the Identify Yourself popup, which is the right door for someone who
    // already has an account and the wrong one for a stranger who followed the
    // QR code — the people this card exists for. Falls back to the join page on
    // the one page that is the join page.
    document.getElementById('btnWelcomeJoin')?.addEventListener('click', () => {
      closeWelcome();
      if (window.openJoinModal) {
        window.openJoinModal();
        return;
      }
      window.location.href = `${pagePrefix()}join/index.html`;
    });

    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeWelcome();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.hidden) closeWelcome();
    });
  }

  function openWelcome() {
    const modal = document.getElementById('welcomeModal');
    if (!modal) return;
    modal.hidden = false;

    // Focus the dialog itself, not a button. Focusing Join put it in its focus
    // state — darker, shadow collapsed — so it sat looking pressed next to an
    // untouched Investigate, as if the two had different styling. Moving focus
    // to the card keeps keyboard users inside the dialog without lighting up
    // one of the two choices before anyone has picked.
    modal.querySelector('.welcome-card')?.focus();
  }

  function closeWelcome() {
    const modal = document.getElementById('welcomeModal');
    if (modal) modal.hidden = true;

    // Drop the hash so a refresh, or a back-and-forward, does not replay the
    // introduction at someone who has already read it.
    if (window.location.hash === WELCOME_HASH) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }

  // This card can open on any page, and the pages are not all at the same
  // depth. Every page's nav mount carries the hop back to the root, so read it
  // from there rather than guessing from the URL.
  function pagePrefix() {
    return document.getElementById('siteNav')?.dataset.prefix || '';
  }
})();
