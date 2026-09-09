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
        <figcaption class="mugshot-lightbox-caption">
          <span class="mugshot-lightbox-name"></span>
          <span class="mugshot-lightbox-subcaption" hidden></span>
        </figcaption>
        <button class="mugshot-lightbox-action" type="button" hidden></button>
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

    caption.querySelector('.mugshot-lightbox-name').textContent = captionText || alt;

    // A second line under the name, for whatever the caller knows and the
    // caption alone does not carry. The suspects page puts the first name here,
    // which only exists for a signed-in visitor: first_name is withheld from
    // the public read, so signed out it arrives empty and the line stays off.
    const sub = caption.querySelector('.mugshot-lightbox-subcaption');
    const subText = String(options.subcaption || '').trim();
    sub.textContent = subText;
    sub.hidden = !subText;

    // An optional button under the picture, for whatever the caller can do with
    // the thing being previewed. The trigger names the button, names the
    // attribute to stamp on it, and may put a value in that attribute; this
    // module never learns what the action does, it only puts the control where
    // the picture is. The value is how an action that is about a particular
    // suspect - rather than about whoever is signed in - knows which one, since
    // the button lives in a shared lightbox and not on the card.
    const action = box.querySelector('.mugshot-lightbox-action');
    const label = String(options.actionLabel || '').trim();
    const flag = String(options.actionFlag || '').trim();
    const value = String(options.actionValue == null ? '' : options.actionValue);

    for (const name of [...action.getAttributeNames()]) {
      if (name.startsWith('data-')) action.removeAttribute(name);
    }

    action.textContent = label;
    action.hidden = !(label && flag);
    if (label && flag) action.setAttribute(`data-${flag}`, value);
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
    const sub = lightbox.querySelector('.mugshot-lightbox-subcaption');
    if(sub){
      sub.textContent = '';
      sub.hidden = true;
    }
    const action = lightbox.querySelector('.mugshot-lightbox-action');
    if(action){
      action.textContent = '';
      action.hidden = true;
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

  // A trigger that is not a real button still has to answer the keyboard. The
  // suspect tracker's booking card is a div carrying role="button", because the
  // photo inside it is already an element of its own.
  document.addEventListener('keydown', (event) => {
    if(event.key !== 'Enter' && event.key !== ' ') return;

    const trigger = event.target.closest('[data-mugshot-lightbox]');
    if(!trigger || trigger.tagName === 'BUTTON') return;

    event.preventDefault();
    trigger.click();
  });

  document.addEventListener('click', (event) => {
    // The picture is about to be replaced, so the preview of the old one should
    // not be sitting behind the file dialog. Deliberately does not stop the
    // event: the module that owns the action is listening further up.
    if(event.target.closest('.mugshot-lightbox-action')){
      closeMugshotLightbox();
      return;
    }

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
        subcaption: trigger.dataset.mugshotSubcaption || '',
        actionLabel: trigger.dataset.mugshotAction || '',
        actionFlag: trigger.dataset.mugshotActionFlag || '',
        actionValue: trigger.dataset.mugshotActionValue || '',
        ...legendColorsFromTrigger(trigger)
      }
    );
  });

  document.addEventListener('keydown', (event) => {
    if(event.key === 'Escape') closeMugshotLightbox();
  });

  window.openMugshotLightbox = openMugshotLightbox;
})();
