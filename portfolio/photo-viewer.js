(() => {
  const main = document.querySelector('main');
  const triggers = Array.from(document.querySelectorAll('button[data-photo], button.gallery-photo'));
  if (!main || !triggers.length || !window.Viewer) return;
  const readPhotos = () => triggers.map((trigger) => ({
    trigger, thumbnail: trigger.querySelector('img'),
    source: trigger.dataset.photo || trigger.querySelector('img')?.src,
    caption: trigger.dataset.caption ?? '', date: trigger.dataset.taken || '', dateLabel: trigger.dataset.takenLabel || '',
  }));
  const photos = readPhotos();
  let viewer, returnFocus, controls, preview;
  let refreshPending = false;
  let fitAfterRotate = false;
  let lastTouchZoom = 0;
  let neighbors = [];

  function viewingArea() {
    const hidden = controls?.classList.contains('controls-hidden');
    return { top: hidden ? 0 : 72, height: viewer.canvas.clientHeight - (hidden ? 0 : 180) };
  }

  function fitRatio() {
    const data = viewer.imageData;
    if (!data?.naturalWidth) return 1;
    const radians = (data.rotate || 0) * Math.PI / 180;
    const width = Math.abs(Math.cos(radians)) * data.naturalWidth + Math.abs(Math.sin(radians)) * data.naturalHeight;
    const height = Math.abs(Math.sin(radians)) * data.naturalWidth + Math.abs(Math.cos(radians)) * data.naturalHeight;
    return Math.min(1, (viewer.canvas.clientWidth - 24) / width, (viewingArea().height - 24) / height);
  }
  function updateSwipe() {
    if (!viewer?.viewed) return;
    viewer.options.slideOnTouch = viewer.imageData.ratio <= fitRatio() * 1.02;
    if (viewer.options.slideOnTouch) viewer.moveTo((viewer.canvas.clientWidth - viewer.imageData.width) / 2,
      viewingArea().top + (viewingArea().height - viewer.imageData.height) / 2);
    else constrainPan();
  }
  function constrainPan() {
    if (!viewer?.viewed || viewer.options.slideOnTouch) return;
    const data = viewer.imageData;
    const radians = (data.rotate || 0) * Math.PI / 180;
    const width = Math.abs(Math.cos(radians)) * data.width + Math.abs(Math.sin(radians)) * data.height;
    const height = Math.abs(Math.sin(radians)) * data.width + Math.abs(Math.cos(radians)) * data.height;
    const area = viewingArea();
    const center = (value, span, start, length) => span <= length ? start + length / 2 : Math.max(start + length - span / 2, Math.min(start + span / 2, value));
    const x = center(data.x + data.width / 2, width, 0, viewer.canvas.clientWidth) - data.width / 2;
    const y = center(data.y + data.height / 2, height, area.top, area.height) - data.height / 2;
    if (Math.abs(data.x - x) > .5 || Math.abs(data.y - y) > .5) viewer.moveTo(x, y);
  }
  function fit() {
    if (!viewer?.viewed) return;
    viewer.zoomTo(fitRatio());
    viewer.moveTo((viewer.canvas.clientWidth - viewer.imageData.width) / 2,
      viewingArea().top + (viewingArea().height - viewer.imageData.height) / 2);
    updateSwipe();
  }
  function toggleZoom(event) {
    if (!viewer?.viewed) return;
    if (viewer.imageData.ratio > fitRatio() * 1.05) fit();
    else {
      const bounds = viewer.canvas.getBoundingClientRect();
      viewer.actionEvent = null;
      viewer.zoomTo(Math.max(1, fitRatio() * 2), false,
        event ? { x: event.clientX - bounds.left, y: event.clientY - bounds.top } : null);
    }
  }
  function detailsHidden(hidden) {
    controls.classList.toggle('controls-hidden', hidden);
    fit();
    controls.querySelector(hidden ? '.viewer-show-controls' : '[data-action="details"]').focus();
  }
  viewer = new Viewer(main, {
    filter: (image) => photos.some((photo) => photo.thumbnail === image),
    url: (image) => image.closest('button').dataset.photo || image.src,
    className: 'gallery-viewer',
    navbar: false, toolbar: false, navigation: false, title: false, button: false,
    keyboard: false, focus: false, tooltip: false, backdrop: 'static',
    inheritedAttributes: ['decoding'],
    initialCoverage: 1, minZoomRatio: () => Math.max(.01, fitRatio()), maxZoomRatio: 4,
    toggleOnDblclick: false, rotateOnTouch: false, rotateOnGesture: false,
    zoomOnWheel: 'ctrl', zoomOnGesture: true, preload: false, transition: false,
    ready() {
      const root = viewer.viewer;
      root.setAttribute('aria-label', 'Photo viewer');
      root.removeAttribute('aria-labelledby');
      root.insertAdjacentHTML('beforeend', '<div class="viewer-preview" hidden></div><div class="viewer-top"><span class="viewer-counter" role="status" aria-live="polite"></span><button type="button" data-action="zoom-out" aria-label="Zoom out">−</button><button type="button" data-action="zoom-in" aria-label="Zoom in">+</button><button type="button" data-action="rotate" aria-label="Rotate photograph 90 degrees clockwise">Rotate ↻</button><button type="button" data-action="fit" aria-label="Reset photograph to fit">Reset</button><button type="button" data-action="details" aria-label="Hide viewer controls">Hide</button><button type="button" data-action="close" aria-label="Close photo viewer">✕</button></div><div class="viewer-bottom"><button type="button" data-action="previous" aria-label="Previous photograph">←</button><div class="viewer-details"><p class="viewer-caption"></p><time class="viewer-date"></time><span class="viewer-help">Pinch or double-tap to zoom · drag to explore</span><span class="viewer-help viewer-feedback" role="status"></span><button type="button" class="viewer-retry" hidden>Retry full photo</button></div><button type="button" data-action="next" aria-label="Next photograph">→</button></div><button type="button" class="viewer-show-controls" aria-label="Show viewer controls">Show controls</button>');
      controls = root;
      preview = root.querySelector('.viewer-preview');
      root.addEventListener('click', (event) => {
        const action = event.target.closest('.viewer-top button, .viewer-bottom > button')?.dataset.action;
        if (!action) return;
        event.stopImmediatePropagation();
        if (action === 'previous') viewer.prev(true);
        if (action === 'next') viewer.next(true);
        if (action === 'close') viewer.hide();
        if (action === 'zoom-in') viewer.zoom(.35);
        if (action === 'zoom-out') {
          if (viewer.imageData.ratio / 1.35 <= fitRatio()) fit();
          else viewer.zoom(-.35);
        }
        if (action === 'rotate') { fitAfterRotate = true; viewer.rotate(90); }
        if (action === 'fit') { viewer.reset(); fit(); }
        if (action === 'details') detailsHidden(true);
      }, true);
      root.querySelector('.viewer-show-controls').addEventListener('click', () => detailsHidden(false));
      root.querySelector('.viewer-retry').addEventListener('click', () => { viewer.viewed = false; viewer.view(viewer.index); });
      root.addEventListener('dblclick', (event) => {
        if (event.target === viewer.image && Date.now() - lastTouchZoom > 500) { event.preventDefault(); toggleZoom(event); }
      });
      let lastTap;
      root.addEventListener('pointerup', (event) => {
        if (event.pointerType !== 'touch' || event.target !== viewer.image || viewer.pointerMoved) { lastTap = null; return; }
        const now = Date.now();
        if (lastTap && now - lastTap.time < 350 && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 30) {
          toggleZoom(event); lastTap = null; lastTouchZoom = now;
        } else lastTap = { time: now, x: event.clientX, y: event.clientY };
      });
    },
    show() { returnFocus ||= document.activeElement; },
    shown() {
      controls.setAttribute('aria-label', 'Photo viewer');
      controls.removeAttribute('aria-labelledby');
      controls.querySelector('[data-action="close"]').focus({ preventScroll: true });
    },
    view(event) {
      const photo = photos[event.detail.index];
      controls.querySelector('.viewer-counter').textContent = `${event.detail.index + 1} / ${photos.length}`;
      controls.querySelector('.viewer-caption').textContent = photo.caption;
      const date = controls.querySelector('.viewer-date');
      date.dateTime = photo.date; date.textContent = photo.dateLabel; date.hidden = !photo.date;
      controls.querySelector('.viewer-feedback').textContent = 'Loading photograph…';
      controls.querySelector('.viewer-retry').hidden = true;
      preview.style.backgroundImage = `url("${photo.thumbnail.currentSrc || photo.thumbnail.src}")`;
      preview.hidden = false;
      event.detail.image.addEventListener('error', () => {
        if (viewer.index !== event.detail.index) return;
        controls.querySelector('.viewer-feedback').textContent = 'Full photo unavailable. Showing the preview if saved.';
        controls.querySelector('.viewer-retry').hidden = false;
      });
    },
    viewed(event) {
      preview.hidden = true;
      const photo = photos[event.detail.index];
      const isFull = new URL(event.detail.image.src).pathname === new URL(photo.source, document.baseURI).pathname;
      controls.querySelector('.viewer-feedback').textContent = isFull ? '' : 'Preview · full photo unavailable';
      controls.querySelector('.viewer-retry').hidden = isFull;
      fit();
      neighbors = [-1, 1].map((step) => {
        const image = new Image();
        image.src = photos[(viewer.index + step + photos.length) % photos.length].source;
        return image;
      });
    },
    zoomed: updateSwipe,
    moved: constrainPan,
    rotated() { if (fitAfterRotate) { fitAfterRotate = false; fit(); } },
    hidden() {
      controls.classList.remove('controls-hidden'); neighbors = [];
      returnFocus?.focus({ preventScroll: true }); returnFocus = null;
      if (refreshPending) refreshPhotos();
    },
  });
  function refreshPhotos() {
    if (viewer.isShown) { refreshPending = true; return; }
    refreshPending = false;
    photos.splice(0, photos.length, ...readPhotos());
    viewer.update();
  }
  document.addEventListener('gallery:photos-updated', refreshPhotos);
  triggers.forEach((trigger, index) => trigger.addEventListener('click', (event) => {
    event.stopPropagation(); returnFocus = trigger; viewer.view(index);
  }));
  document.addEventListener('keydown', (event) => {
    if (!viewer.isShown || event.altKey || event.ctrlKey || event.metaKey) return;
    const actions = { Escape: () => viewer.hide(), ArrowLeft: () => viewer.prev(true), ArrowRight: () => viewer.next(true),
      '+': () => viewer.zoom(.35), '=': () => viewer.zoom(.35), '-': () => viewer.zoom(-.35), '0': fit,
      r: () => { fitAfterRotate = true; viewer.rotate(90); } };
    if (event.key === 'Tab') {
      const buttons = Array.from(controls.querySelectorAll('button')).filter((button) => !button.hidden && button.getClientRects().length);
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    } else if (actions[event.key]) { event.preventDefault(); actions[event.key](); }
  });
  window.addEventListener('resize', () => requestAnimationFrame(fit));
})();
