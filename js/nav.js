// The header menu, injected into every page so the two pages can never drift
// apart. Mark the current page with:
//   <div id="siteNav" data-current="victims"></div>

const NAV_ITEMS = [
  { label: 'Precinct',   key: 'home',    href: 'index.html', sublabel: 'Home' },
  // Land on the open week so the page and the header badge agree.
  { label: 'Victims',    key: 'victims',
    href: () => `victims.html?week=${window.CURRENT_WEEK || 1}`,
    sublabel: 'Make Your Pick' },
  { label: 'Suspects',   key: 'suspects', href: 'suspects/index.html', sublabel: 'FF Players' },
  // Sublabel instead of a title: the gloss shows without needing a hover.
  { label: 'The Law',    key: 'law',     href: 'law.html', sublabel: 'Rules' },
  { label: 'Report',     key: 'report',  href: 'report.html', sublabel: 'The Numbers' },
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
