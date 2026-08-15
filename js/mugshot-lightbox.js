(function(){
  let lightbox = null;
  let previousFocus = null;

  function ensureLightbox(){
    if(lightbox) return lightbox;

    lightbox = document.createElement('div');
    lightbox.className = 'mugshot-lightbox';
    lightbox.hidden = true;
    lightbox.innerHTML = `
      <div class="mugshot-lightbox-backdrop" data-mugshot-close></div>
      <figure class="mugshot-lightbox-card" role="dialog" aria-modal="true" aria-label="Image preview">
        <button class="mugshot-lightbox-close" type="button" data-mugshot-close aria-label="Close image preview">X</button>
        <img class="mugshot-lightbox-image" alt="Image preview"/>
        <span class="mugshot-lightbox-symbol" hidden></span>
        <figcaption class="mugshot-lightbox-caption"></figcaption>
      </figure>
    `;
    document.body.appendChild(lightbox);
    return lightbox;
  }

  function mugshotSourceFromTrigger(trigger){
    if(trigger.dataset.mugshotSrc) return trigger.dataset.mugshotSrc;

    const image = trigger.querySelector('img');
    if(image?.currentSrc || image?.src) return image.currentSrc || image.src;

    const canvas = trigger.querySelector('canvas');
    if(canvas) return canvas.toDataURL('image/png');

    return '';
  }

  // The caption and the alt text are not the same thing. The caption is read
  // next to a picture that is already on screen, so it only needs the name;
  // the alt text stands in for the picture entirely and has to say what it is.
  function legendColorsFromTrigger(trigger){
    const source = trigger?.closest?.('.lineup-emoji-key-mark');
    if(!source) return {};

    const styles = window.getComputedStyle(source);
    return {
      background: styles.backgroundColor,
      border: styles.borderTopColor
    };
  }

  function openMugshotLightbox(src, alt = 'Image preview', captionText = '', size = '', options = {}){
    if(!src && !options.symbol) return;

    const box = ensureLightbox();
    const card = box.querySelector('.mugshot-lightbox-card');
    const image = box.querySelector('.mugshot-lightbox-image');
    const symbol = box.querySelector('.mugshot-lightbox-symbol');
    const caption = box.querySelector('.mugshot-lightbox-caption');
    const closeButton = box.querySelector('.mugshot-lightbox-close');

    previousFocus = document.activeElement;
    card.classList.toggle('mugshot-lightbox-card-icon', size === 'icon');
    if(options.background){
      card.style.setProperty('--mugshot-preview-bg', options.background);
    } else {
      card.style.removeProperty('--mugshot-preview-bg');
    }
    if(options.border){
      card.style.setProperty('--mugshot-preview-border', options.border);
    } else {
      card.style.removeProperty('--mugshot-preview-border');
    }

    if(options.symbol){
      image.hidden = true;
      image.removeAttribute('src');
      image.alt = '';
      symbol.hidden = false;
      symbol.textContent = options.symbol;
      symbol.setAttribute('role', 'img');
      symbol.setAttribute('aria-label', alt);
    } else {
      symbol.hidden = true;
      symbol.textContent = '';
      symbol.removeAttribute('role');
      symbol.removeAttribute('aria-label');
      image.hidden = false;
      image.src = src;
      image.alt = alt;
    }

    caption.textContent = captionText || alt;
    box.hidden = false;
    document.body.classList.add('mugshot-lightbox-open');
    closeButton.focus();
  }

  function closeMugshotLightbox(){
    if(!lightbox || lightbox.hidden) return;

    lightbox.hidden = true;
    document.body.classList.remove('mugshot-lightbox-open');
    const card = lightbox.querySelector('.mugshot-lightbox-card');
    const image = lightbox.querySelector('.mugshot-lightbox-image');
    const symbol = lightbox.querySelector('.mugshot-lightbox-symbol');
    if(image){
      image.removeAttribute('src');
      image.hidden = false;
    }
    if(symbol){
      symbol.textContent = '';
      symbol.hidden = true;
      symbol.removeAttribute('role');
      symbol.removeAttribute('aria-label');
    }
    if(card){
      card.classList.remove('mugshot-lightbox-card-icon');
      card.style.removeProperty('--mugshot-preview-bg');
      card.style.removeProperty('--mugshot-preview-border');
    }

    if(previousFocus && typeof previousFocus.focus === 'function'){
      previousFocus.focus();
    }
    previousFocus = null;
  }

  document.addEventListener('click', (event) => {
    const closeTrigger = event.target.closest('[data-mugshot-close]');
    if(closeTrigger){
      event.preventDefault();
      closeMugshotLightbox();
      return;
    }

    const trigger = event.target.closest('[data-mugshot-lightbox]');
    if(!trigger) return;

    event.preventDefault();
    openMugshotLightbox(
      mugshotSourceFromTrigger(trigger),
      trigger.dataset.mugshotAlt || trigger.getAttribute('aria-label') || 'Image preview',
      trigger.dataset.mugshotCaption || '',
      trigger.dataset.mugshotLightboxSize || '',
      {
        symbol: trigger.dataset.mugshotSymbol || '',
        ...legendColorsFromTrigger(trigger)
      }
    );
  });

  document.addEventListener('keydown', (event) => {
    if(event.key === 'Escape') closeMugshotLightbox();
  });

  window.openMugshotLightbox = openMugshotLightbox;
})();
