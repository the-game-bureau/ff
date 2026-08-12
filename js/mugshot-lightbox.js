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
      <figure class="mugshot-lightbox-card" role="dialog" aria-modal="true" aria-label="Mugshot preview">
        <button class="mugshot-lightbox-close" type="button" data-mugshot-close aria-label="Close mugshot preview">X</button>
        <img class="mugshot-lightbox-image" alt="Mugshot preview"/>
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

  function openMugshotLightbox(src, alt = 'Mugshot preview'){
    if(!src) return;

    const box = ensureLightbox();
    const image = box.querySelector('.mugshot-lightbox-image');
    const caption = box.querySelector('.mugshot-lightbox-caption');
    const closeButton = box.querySelector('.mugshot-lightbox-close');

    previousFocus = document.activeElement;
    image.src = src;
    image.alt = alt;
    caption.textContent = alt;
    box.hidden = false;
    document.body.classList.add('mugshot-lightbox-open');
    closeButton.focus();
  }

  function closeMugshotLightbox(){
    if(!lightbox || lightbox.hidden) return;

    lightbox.hidden = true;
    document.body.classList.remove('mugshot-lightbox-open');
    const image = lightbox.querySelector('.mugshot-lightbox-image');
    if(image) image.removeAttribute('src');

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
      trigger.dataset.mugshotAlt || trigger.getAttribute('aria-label') || 'Mugshot preview'
    );
  });

  document.addEventListener('keydown', (event) => {
    if(event.key === 'Escape') closeMugshotLightbox();
  });

  window.openMugshotLightbox = openMugshotLightbox;
})();
