(() => {
  const main = document.querySelector('main');
  const triggers = Array.from(document.querySelectorAll('button[data-photo], button.gallery-photo'));
  if (!main || !triggers.length || !window.Viewer) return;
  const photoId = (trigger) => trigger.dataset.photoId || new URL(trigger.dataset.photo || trigger.querySelector('img').src, document.baseURI)
    .pathname.split('/').pop().replace(/\.[^.]+$/, '').replace(/-v\d+$/, '');
  const readPhotos = () => triggers.map((trigger) => ({
    trigger, id: photoId(trigger), thumbnail: trigger.querySelector('img'),
    source: trigger.dataset.photo || trigger.querySelector('img')?.src,
    caption: trigger.dataset.caption ?? '', date: trigger.dataset.taken || '', dateLabel: trigger.dataset.takenLabel || '',
  }));
  const photos = readPhotos();
  let viewer, returnFocus, controls, preview, resizeObserver, fitFrame;
  let refreshPending = false;
  let fitAfterRotate = false;
  let lastTouchZoom = 0;
  let neighbors = [];

  // Read the actual caption/rating tray: wrapped text and phone safe areas vary in height.
  function viewingArea() {
    const bounds = viewer.canvas.getBoundingClientRect();
    const hidden = controls?.classList.contains('controls-hidden');
    const gutter = hidden ? 12 : parseFloat(getComputedStyle(controls).getPropertyValue('--viewer-stage-gutter')) || 56;
    const top = hidden ? 12 : Math.max(12, controls.querySelector('.viewer-top').getBoundingClientRect().bottom - bounds.top + 12);
    const bottom = hidden ? bounds.height - 12 : Math.min(bounds.height - 12, controls.querySelector('.viewer-bottom').getBoundingClientRect().top - bounds.top - 20);
    return { left: gutter, top, width: Math.max(24, bounds.width - gutter * 2), height: Math.max(24, bottom - top) };
  }
  function measureStage() {
    if (!controls || !viewer.isShown) return;
    const area = viewingArea();
    const canvas = viewer.canvas.getBoundingClientRect();
    // Zoom/pan keep the full-canvas coordinate system, but the photograph must
    // never paint underneath the caption, rating tray or toolbar.
    viewer.canvas.style.clipPath = `inset(${area.top}px ${Math.max(0, canvas.width - area.left - area.width)}px ${Math.max(0, canvas.height - area.top - area.height)}px ${area.left}px)`;
    controls.style.setProperty('--viewer-stage-center', `${area.top + area.height / 2}px`);
    Object.assign(preview.style, { left: `${area.left}px`, top: `${area.top}px`, width: `${area.width}px`, height: `${area.height}px` });
  }
  function scheduleFit() {
    cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(() => { measureStage(); fit(); });
  }
  function fitRatio() {
    const data = viewer.imageData;
    if (!data?.naturalWidth) return 1;
    const radians = (data.rotate || 0) * Math.PI / 180;
    const width = Math.abs(Math.cos(radians)) * data.naturalWidth + Math.abs(Math.sin(radians)) * data.naturalHeight;
    const height = Math.abs(Math.sin(radians)) * data.naturalWidth + Math.abs(Math.cos(radians)) * data.naturalHeight;
    const area = viewingArea();
    return Math.min(1, area.width / width, area.height / height);
  }
  function centerPhoto() {
    const area = viewingArea();
    viewer.moveTo(area.left + (area.width - viewer.imageData.width) / 2,
      area.top + (area.height - viewer.imageData.height) / 2);
  }
  function updateSwipe() {
    if (!viewer?.viewed) return;
    viewer.options.slideOnTouch = viewer.imageData.ratio <= fitRatio() * 1.02;
    if (viewer.options.slideOnTouch) centerPhoto();
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
    const x = center(data.x + data.width / 2, width, area.left, area.width) - data.width / 2;
    const y = center(data.y + data.height / 2, height, area.top, area.height) - data.height / 2;
    if (Math.abs(data.x - x) > .5 || Math.abs(data.y - y) > .5) viewer.moveTo(x, y);
  }
  function fit() {
    if (!viewer?.viewed) return;
    viewer.zoomTo(fitRatio());
    centerPhoto();
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
    measureStage(); fit();
    controls.querySelector(hidden ? '.viewer-show-controls' : '[data-action="details"]').focus();
  }
  function fullscreenElement() { return document.fullscreenElement || document.webkitFullscreenElement; }
  function updateFullscreen() {
    const button = controls?.querySelector('[data-action="fullscreen"]');
    if (!button) return;
    const active = fullscreenElement() === controls;
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
    button.title = active ? 'Exit fullscreen' : 'Enter fullscreen';
    scheduleFit();
  }
  async function toggleFullscreen() {
    try {
      if (fullscreenElement() === controls) await (document.exitFullscreen?.() || document.webkitExitFullscreen?.());
      else {
        await (controls.requestFullscreen?.() || controls.webkitRequestFullscreen?.());
        if (fullscreenElement() !== controls) controls.querySelector('.viewer-feedback').textContent = 'Fullscreen is unavailable in this browser.';
      }
    } catch {
      controls.querySelector('.viewer-feedback').textContent = 'Fullscreen is unavailable in this browser.';
    }
  }
  const icon = (paths) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const icons = {
    'zoom-out': icon('<circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6M7 10h6"/>'),
    'zoom-in': icon('<circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6M7 10h6M10 7v6"/>'),
    rotate: icon('<path d="M19 8a8 8 0 1 0 1 7M19 3v5h-5"/>'),
    fullscreen: icon('<path d="M4 9V4h5m6 0h5v5m0 6v5h-5M9 20H4v-5"/>'),
    fit: icon('<path d="M4 4h5M4 4v5m16-5h-5m5 0v5M4 20h5m-5 0v-5m16 5h-5m5 0v-5M9 9h6v6H9z"/>'),
    details: icon('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path d="m3 3 18 18"/>'),
    close: icon('<path d="m5 5 14 14M19 5 5 19"/>'),
    previous: icon('<path d="m15 4-8 8 8 8"/>'),
    next: icon('<path d="m9 4 8 8-8 8"/>'),
  };
  const actionButton = (action, label, extra = '') => `<button type="button" data-action="${action}" aria-label="${label}" title="${label}" ${extra}>${icons[action]}</button>`;
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
      root.insertAdjacentHTML('beforeend', `<div class="viewer-preview" hidden></div>
        <div class="viewer-top"><span class="viewer-counter" role="status" aria-live="polite"></span>
          <div class="viewer-tools" role="group" aria-label="Photograph tools">
            ${actionButton('zoom-out', 'Zoom out')}${actionButton('zoom-in', 'Zoom in')}
            ${actionButton('rotate', 'Rotate photograph 90 degrees clockwise')}${actionButton('fullscreen', 'Enter fullscreen', 'aria-pressed="false"')}
            ${actionButton('fit', 'Reset photograph to fit')}${actionButton('details', 'Hide viewer controls')}
          </div>${actionButton('close', 'Close photo viewer')}
        </div>
        <div class="viewer-side-nav">${actionButton('previous', 'Previous photograph')}${actionButton('next', 'Next photograph')}</div>
        <div class="viewer-bottom"><div class="viewer-details"><p class="viewer-caption"></p><time class="viewer-date"></time>
          <span class="viewer-feedback" role="status" aria-live="polite"></span><button type="button" class="viewer-retry" hidden>Retry full photo</button>
        </div><div class="viewer-rating" data-viewer-rating></div></div>
        <button type="button" class="viewer-show-controls" aria-label="Show viewer controls">Show controls</button>`);
      controls = root;
      preview = root.querySelector('.viewer-preview');
      root.querySelector('[data-action="fullscreen"]').hidden = !((root.requestFullscreen && document.fullscreenEnabled !== false) ||
        (root.webkitRequestFullscreen && document.webkitFullscreenEnabled !== false));
      root.addEventListener('click', (event) => {
        const action = event.target.closest('.viewer-top [data-action], .viewer-side-nav [data-action]')?.dataset.action;
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
        if (action === 'fullscreen') toggleFullscreen();
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
      if (window.ResizeObserver) {
        resizeObserver = new ResizeObserver(scheduleFit);
        resizeObserver.observe(root.querySelector('.viewer-top'));
        resizeObserver.observe(root.querySelector('.viewer-bottom'));
        resizeObserver.observe(root);
      }
      document.dispatchEvent(new CustomEvent('gallery:viewer-ready', { detail: { root, host: root.querySelector('[data-viewer-rating]') } }));
    },
    show() { returnFocus ||= document.activeElement; },
    shown() {
      controls.setAttribute('aria-label', 'Photo viewer');
      controls.removeAttribute('aria-labelledby');
      controls.querySelector('[data-action="close"]').focus({ preventScroll: true });
      measureStage();
    },
    view(event) {
      const photo = photos[event.detail.index];
      controls.dataset.photoId = photo.id;
      controls.querySelector('.viewer-counter').textContent = `${String(event.detail.index + 1).padStart(2, '0')} / ${photos.length}`;
      controls.querySelector('.viewer-caption').textContent = photo.caption;
      controls.querySelector('.viewer-caption').hidden = !photo.caption;
      const date = controls.querySelector('.viewer-date');
      date.dateTime = photo.date; date.textContent = photo.dateLabel; date.hidden = !photo.date;
      controls.querySelector('.viewer-feedback').textContent = 'Loading photograph…';
      controls.querySelector('.viewer-retry').hidden = true;
      preview.style.backgroundImage = `url("${photo.thumbnail.currentSrc || photo.thumbnail.src}")`;
      preview.hidden = false;
      document.dispatchEvent(new CustomEvent('gallery:viewer-photo', { detail: {
        photoId: photo.id, title: photo.caption, trigger: photo.trigger, host: controls.querySelector('[data-viewer-rating]'),
      } }));
      measureStage();
      event.detail.image.addEventListener('error', () => {
        if (viewer.index !== event.detail.index) return;
        controls.querySelector('.viewer-feedback').textContent = 'Full photo unavailable. Showing the preview if saved.';
        controls.querySelector('.viewer-retry').hidden = false;
      }, { once: true });
    },
    viewed(event) {
      preview.hidden = true;
      const photo = photos[event.detail.index];
      const isFull = new URL(event.detail.image.src).pathname === new URL(photo.source, document.baseURI).pathname;
      controls.querySelector('.viewer-feedback').textContent = isFull ? '' : 'Preview · full photo unavailable';
      controls.querySelector('.viewer-retry').hidden = isFull;
      measureStage(); fit();
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
      if (fullscreenElement() === controls) {
        const exiting = document.exitFullscreen?.() || document.webkitExitFullscreen?.();
        exiting?.catch?.(() => {});
      }
      controls.classList.remove('controls-hidden'); neighbors = [];
      document.dispatchEvent(new CustomEvent('gallery:viewer-hidden'));
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
  document.addEventListener('fullscreenchange', updateFullscreen);
  document.addEventListener('webkitfullscreenchange', updateFullscreen);
  triggers.forEach((trigger, index) => trigger.addEventListener('click', (event) => {
    event.stopPropagation(); returnFocus = trigger; viewer.view(index);
  }));
  document.addEventListener('keydown', (event) => {
    if (!viewer.isShown || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Escape') { event.preventDefault(); viewer.hide(); return; }
    if (event.defaultPrevented) return;
    if (event.key === 'Tab') {
      const focusable = Array.from(controls.querySelectorAll('button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])'))
        .filter((element) => !element.disabled && element.tabIndex >= 0 && element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === controls)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      return;
    }
    if (event.target.closest?.('.viewer-rating, [role="radiogroup"], input, select, textarea, [contenteditable="true"]')) return;
    const actions = { ArrowLeft: () => viewer.prev(true), ArrowRight: () => viewer.next(true),
      '+': () => viewer.zoom(.35), '=': () => viewer.zoom(.35), '-': () => viewer.zoom(-.35), '0': fit,
      r: () => { fitAfterRotate = true; viewer.rotate(90); } };
    if (actions[event.key]) { event.preventDefault(); actions[event.key](); }
  });
  window.addEventListener('resize', scheduleFit);
})();
