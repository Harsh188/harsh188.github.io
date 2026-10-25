(() => {
  const dialog = document.querySelector('.lightbox');
  const triggers = document.querySelectorAll('button[data-photo], button.gallery-photo');

  if (!dialog || !triggers.length || typeof dialog.showModal !== 'function') return;

  const image = dialog.querySelector('img');
  const caption = dialog.querySelector('p');
  const takenDate = dialog.querySelector('.photo-date');
  const closeButton = dialog.querySelector('.close-photo');
  const navigation = dialog.querySelector('.photo-navigation');
  const previousButton = dialog.querySelector('.previous-photo');
  const nextButton = dialog.querySelector('.next-photo');
  const position = dialog.querySelector('.photo-position');
  const originalSource = image?.src;
  const originalCaption = caption?.textContent || '';
  const neighborPreloads = [];
  let currentIndex = 0;
  let returnFocus = null;
  let swipeStart = null;

  if (!image) return;

  const photos = Array.from(triggers, (trigger) => {
    const thumbnail = trigger.querySelector('img');
    return {
      trigger,
      source: trigger.dataset.photo || thumbnail?.currentSrc || thumbnail?.src,
      alt: thumbnail?.alt || '',
      caption: trigger.dataset.caption,
      date: trigger.dataset.taken,
      dateLabel: trigger.dataset.takenLabel,
    };
  }).filter((photo) => photo.source);

  if (!photos.length) return;

  const hasMultiplePhotos = photos.length > 1;
  if (navigation) navigation.hidden = !hasMultiplePhotos;
  [previousButton, nextButton].forEach((button) => {
    if (button) {
      button.hidden = !hasMultiplePhotos;
      button.disabled = !hasMultiplePhotos;
    }
  });
  if (position) position.hidden = !hasMultiplePhotos;

  if (caption && !dialog.hasAttribute('aria-describedby')) {
    if (!caption.id) caption.id = 'lightbox-caption';
    dialog.setAttribute('aria-describedby', caption.id);
  }

  function showPhoto(index) {
    currentIndex = (index + photos.length) % photos.length;
    const photo = photos[currentIndex];
    image.src = photo.source;
    image.alt = photo.alt;
    if (caption) {
      caption.textContent = photo.caption ??
        (image.src === originalSource ? originalCaption : photo.alt);
    }
    if (position) position.textContent = `${currentIndex + 1} / ${photos.length}`;
    if (takenDate) {
      takenDate.hidden = !photo.date;
      takenDate.dateTime = photo.date || '';
      takenDate.textContent = photo.dateLabel || '';
    }
    swipeStart = null;

    neighborPreloads.length = 0;
    if (hasMultiplePhotos) {
      const sources = new Set([
        photos[(currentIndex - 1 + photos.length) % photos.length].source,
        photos[(currentIndex + 1) % photos.length].source,
      ]);
      sources.forEach((source) => {
        const preload = new Image();
        preload.decoding = 'async';
        preload.src = source;
        neighborPreloads.push(preload);
      });
    }
  }

  function movePhoto(step) {
    if (dialog.open && hasMultiplePhotos) showPhoto(currentIndex + step);
  }

  photos.forEach((photo, index) => {
    photo.trigger.addEventListener('click', () => {
      showPhoto(index);
      returnFocus = photo.trigger;
      if (!dialog.open) dialog.showModal();
      closeButton?.focus({ preventScroll: true });
    });
  });

  previousButton?.addEventListener('click', () => movePhoto(-1));
  nextButton?.addEventListener('click', () => movePhoto(1));
  closeButton?.addEventListener('click', () => dialog.close());

  document.addEventListener('keydown', (event) => {
    if (!dialog.open || !hasMultiplePhotos || event.defaultPrevented ||
        event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.target?.isContentEditable || event.target?.closest?.('input, textarea, select')) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

    event.preventDefault();
    movePhoto(event.key === 'ArrowRight' ? 1 : -1);
  });

  image.addEventListener('touchstart', (event) => {
    swipeStart = null;
    if (!dialog.open || !hasMultiplePhotos || event.touches.length !== 1) return;
    const touch = event.touches[0];
    swipeStart = { id: touch.identifier, x: touch.clientX, y: touch.clientY };
  }, { passive: true });

  image.addEventListener('touchmove', (event) => {
    if (event.touches.length !== 1) swipeStart = null;
  }, { passive: true });

  image.addEventListener('touchend', (event) => {
    const start = swipeStart;
    swipeStart = null;
    if (!start || event.touches.length) return;
    const touch = Array.from(event.changedTouches).find((item) => item.identifier === start.id);
    if (!touch) return;
    const horizontal = touch.clientX - start.x;
    const vertical = touch.clientY - start.y;
    if (Math.abs(horizontal) >= 50 && Math.abs(horizontal) > Math.abs(vertical) * 1.5) {
      movePhoto(horizontal < 0 ? 1 : -1);
    }
  }, { passive: true });

  image.addEventListener('touchcancel', () => { swipeStart = null; }, { passive: true });

  // Native Escape handling also emits close, so every dismissal restores focus.
  dialog.addEventListener('close', () => {
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
    swipeStart = null;
    neighborPreloads.length = 0;
  });

  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    const outside = event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom;
    if (outside) dialog.close();
  });
})();
