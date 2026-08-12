// The header menu, injected into every page so the two pages can never drift
// apart. Mark the current page with:
//   <div id="siteNav" data-current="victims"></div>

// Ordered by how often a player needs them, which is also the order they come
// up in a season: start here, make this week's pick, check how it went, see who
// else is playing, look up a rule, then last year's file.
const NAV_ITEMS = [
  { label: 'Precinct',   key: 'home',    href: 'index.html', sublabel: 'Home' },
  // Land on the open week so the page and the header badge agree.
  { label: 'Victims',    key: 'victims',
    href: () => `victims/index.html?week=${window.CURRENT_WEEK || 1}`,
    sublabel: 'Make Your Pick' },
  { label: 'Case File',  key: 'report',  href: 'reports/index.html', sublabel: 'Stats & Picks' },
  { label: 'Suspects',   key: 'suspects', href: 'suspects/index.html', sublabel: 'FF Players' },
  // Sublabel instead of a title: the gloss shows without needing a hover.
  { label: 'The Law',    key: 'law',     href: 'law/index.html', sublabel: 'Rules' },
  // New tab: the archive is a different season with its own gate, and leaving
  // it in place means you come back to the live site rather than back through
  // it. external drives target="_blank" in the renderer below.
  { label: 'Cold Cases', key: 'archive', href: '2025/index.html',
    sublabel: 'League Archive', external: true }];

function renderSiteNav(){
  const mount = document.getElementById('siteNav');
  if(!mount) return;

  const current = mount.dataset.current || '';
  const prefix = mount.dataset.prefix || '';

  const items = NAV_ITEMS.map((item) => {
    const isCurrent = item.key === current;

    // Pages with the shared auth corner can open this in place; older pages
    // still fall back to the home page hash.
    let href;
    const rawHref = typeof item.href === 'function' ? item.href() : item.href;

    if(rawHref === '#signin'){
      href = current === 'home' ? '#signin' : prefix + 'index.html#signin';
    } else if(rawHref.startsWith('#')){
      href = rawHref;
    } else if(/^https?:\/\//.test(rawHref)){
      href = rawHref;
    } else {
      href = prefix + rawHref;
    }

    // A sublabel is a plain-English gloss hung under the button, for the
    // themed names that don't say what they are ("Victims" = NFL teams).
    const sublabel = item.sublabel
      ? `<span class="nav-sublabel">${item.sublabel}</span>`
      : '';

    // A disabled item is a span, not a link: there is nothing to navigate to,
    // so it should not be clickable, focusable, or offer a target to open in a
    // new tab. The tooltip says why.
    // data-tooltip, not title: the CSS tooltip appears immediately and in the
    // site's own type, where the browser's native one waits about a second and
    // renders in the OS style. Using both would show two tooltips at once.
    if(item.disabled){
      return `<li><span class="nav-btn nav-btn-disabled"
        data-tooltip="${item.title || 'Coming Soon'}"
        aria-disabled="true">${item.label}</span>${sublabel}</li>`;
    }

    return `<li><a class="nav-btn${isCurrent ? ' nav-btn-current' : ''}"
      href="${isCurrent ? '#' : href}"
      ${item.external ? 'target="_blank" rel="noopener noreferrer"' : ''}
      ${item.title ? `title="${item.title}"` : ''}
      ${isCurrent ? 'aria-current="page"' : ''}>
      ${item.label}</a>${sublabel}</li>`;
  }).join('');

  // The toggle is always in the markup and always focusable; CSS hides it above
  // the phone breakpoint, where the full row of buttons fits on one line. The
  // list is never removed from the DOM, so nothing here depends on JS to make
  // the menu readable — a phone with the script blocked still shows every item.
  mount.innerHTML = `
    <nav class="main-nav" role="navigation" aria-label="Main menu">
      <button class="nav-toggle" id="navToggle" type="button"
              aria-expanded="false" aria-controls="mainNavList">
        <span class="nav-toggle-bars" aria-hidden="true"></span>
        <span class="nav-toggle-label">Menu</span>
      </button>
      <ul class="main-nav-list" id="mainNavList">${items}</ul>
    </nav>`;

  wireNavToggle(mount);
  renderNavAuth(mount);
}

// ===== ESCAPE / LOGIN-JOIN IN THE PHONE MENU =====
// On a phone the header corner is hidden and these two rows take its place at
// the foot of the hamburger. CSS keeps them out of the desktop button bar.
//
// They are proxies, not a second implementation. Two different modules build
// the header corner — js/auth-corner.js injects it on most pages, index.html
// carries it in markup and drives it from js/app.js — but both end up with the
// same ids, and both mark signed-in state by toggling `hidden` on the two
// stacks. So this reads that state and forwards clicks, which is why it works
// the same on every page including the Precinct. It used to live in
// auth-corner.js, which is exactly why the Precinct was the one page it never
// appeared on.
const NAV_AUTH_ITEMS = [
  { id: 'navEscapeItem', stack: 'headerIdStack',   source: 'btnSignOut',
    label: 'Escape',       sublabel: 'Sign Out' },
  { id: 'navSignInItem', stack: 'headerAuthStack', source: 'headerSignIn',
    label: 'Login / Join', sublabel: 'Get In The Game' }
];

function renderNavAuth(mount){
  const list = mount.querySelector('.main-nav-list');
  if(!list) return;

  for(const item of NAV_AUTH_ITEMS){
    const li = document.createElement('li');
    li.id = item.id;
    li.className = 'nav-auth-item';
    // Hidden until the state is known, so neither flashes up before the auth
    // module has decided which of the two belongs on screen.
    li.hidden = true;
    li.innerHTML =
      `<button class="nav-btn" type="button">${item.label}</button>` +
      `<span class="nav-sublabel">${item.sublabel}</span>`;

    li.querySelector('button').addEventListener('click', () => {
      closeNavPanel(mount);
      // Click the real control rather than re-implementing sign-out: whichever
      // module owns this page has already wired it.
      document.getElementById(item.source)?.click();
    });

    list.appendChild(li);
  }

  // Tells the stylesheet the phone header corner is now a duplicate.
  document.body.classList.add('has-nav-auth');

  syncNavAuth();

  // The corner may not exist yet (auth-corner.js builds it on the same
  // DOMContentLoaded, and the stacks flip later once the session resolves), so
  // watch for both rather than reading once and hoping.
  new MutationObserver(syncNavAuth).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden', 'disabled']
  });

  window.addEventListener('ff-auth-changed', syncNavAuth);
}

// Mirror the header corner: each row is visible exactly when its counterpart
// is. No corner on the page at all means no rows.
function syncNavAuth(){
  for(const item of NAV_AUTH_ITEMS){
    const row = document.getElementById(item.id);
    if(!row) continue;

    const stack = document.getElementById(item.stack);
    const source = document.getElementById(item.source);
    const shown = Boolean(stack) && !stack.hidden && Boolean(source);

    if(row.hidden === !shown) continue;
    row.hidden = !shown;
  }
}

function closeNavPanel(mount){
  const nav = mount.querySelector('.main-nav');
  nav?.classList.remove('nav-open');
  mount.querySelector('.nav-toggle')?.setAttribute('aria-expanded', 'false');
}

// Open/close for the phone menu. Nothing runs on a desktop width beyond the
// listeners themselves: .nav-open only means anything inside the phone media
// query.
function wireNavToggle(mount){
  const nav = mount.querySelector('.main-nav');
  const toggle = mount.querySelector('.nav-toggle');
  if(!nav || !toggle) return;

  const phone = window.matchMedia('(max-width: 767px)');

  function setOpen(open){
    nav.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  toggle.addEventListener('click', () => {
    setOpen(!nav.classList.contains('nav-open'));
  });

  // Tapping an item navigates, but same-page links (the current page, #signin)
  // would otherwise leave the panel hanging open over the content.
  nav.querySelector('.main-nav-list').addEventListener('click', (event) => {
    if(event.target.closest('a')) setOpen(false);
  });

  document.addEventListener('click', (event) => {
    if(!nav.classList.contains('nav-open')) return;
    if(!nav.contains(event.target)) setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if(event.key !== 'Escape') return;
    if(!nav.classList.contains('nav-open')) return;
    setOpen(false);
    toggle.focus();
  });

  // Rotating a phone to landscape can cross the breakpoint, which reveals the
  // full row anyway; drop the open state so the toggle doesn't come back
  // claiming to be expanded.
  phone.addEventListener('change', (event) => {
    if(!event.matches) setOpen(false);
  });
}

document.addEventListener('DOMContentLoaded', renderSiteNav);
