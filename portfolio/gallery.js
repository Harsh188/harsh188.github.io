(() => {
  const dialog = document.querySelector('.lightbox');
  const triggers = document.querySelectorAll('button[data-photo], button.gallery-photo');

  if (!dialog || !triggers.length || typeof dialog.showModal !== 'function') return;

  const image = dialog.querySelector('img');
  const caption = dialog.querySelector('p');
  const closeButton = dialog.querySelector('.close-photo');
  const originalSource = image?.src;
  const originalCaption = caption?.textContent || '';
  let returnFocus = null;

  if (!image) return;

  if (caption && !dialog.hasAttribute('aria-describedby')) {
    if (!caption.id) caption.id = 'lightbox-caption';
    dialog.setAttribute('aria-describedby', caption.id);
  }

  triggers.forEach((trigger) => {
    trigger.addEventListener('click', () => {
      const thumbnail = trigger.querySelector('img');
      const source = trigger.dataset.photo || thumbnail?.currentSrc || thumbnail?.src;
      if (!source) return;

      image.src = source;
      image.alt = thumbnail?.alt || '';
      if (caption) {
        caption.textContent = trigger.dataset.caption ??
          (image.src === originalSource ? originalCaption : image.alt);
      }

      returnFocus = trigger;
      if (!dialog.open) dialog.showModal();
      closeButton?.focus({ preventScroll: true });
    });
  });

  closeButton?.addEventListener('click', () => dialog.close());

  // Native Escape handling also emits close, so every dismissal restores focus.
  dialog.addEventListener('close', () => {
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  });

  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    const outside = event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom;
    if (outside) dialog.close();
  });
})();
