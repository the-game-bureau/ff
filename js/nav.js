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
    href: () => `victims.html?week=${window.CURRENT_WEEK || 1}`,
    sublabel: 'Make Your Pick' },
  // Not wired up yet. report.html still exists and still works if you visit it
  // directly; this button just doesn't lead there until the numbers are real.
  { label: 'Case File',  key: 'report',  href: 'report.html', sublabel: 'Stats & Picks',
    disabled: true, title: 'Coming Soon' },
  { label: 'Suspects',   key: 'suspects', href: 'suspects/index.html', sublabel: 'FF Players' },
  // Sublabel instead of a title: the gloss shows without needing a hover.
  { label: 'The Law',    key: 'law',     href: 'law.html', sublabel: 'Rules' },
  { label: 'Cold Cases', key: 'archive', href: '2025/index.html',
    sublabel: 'League Archive' }];

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

  mount.innerHTML = `
    <nav class="main-nav" role="navigation" aria-label="Main menu">
      <ul class="main-nav-list">${items}</ul>
    </nav>`;
}

document.addEventListener('DOMContentLoaded', renderSiteNav);
