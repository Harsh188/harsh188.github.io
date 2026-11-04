(() => {
  'use strict';
  const ratings = window.PhotoRatings;
  const slots = Array.from(document.querySelectorAll('[data-featured-slot]'));
  const status = document.querySelector('.visitor-favorites-note');
  if (!ratings || !slots.length || !status) return;
  const label = document.querySelector('[data-favorites-label]');
  const description = document.querySelector('[data-favorites-description]');
  const originalLabel = label?.textContent;
  const originalDescription = description?.textContent;
  const originals = slots.map((slot) => ({ html: slot.innerHTML, className: slot.className }));
  let loading = false;
  let changed = false;

  function whenViewerClosed() {
    const open = () => Boolean(document.querySelector('.lightbox[open]') ||
      document.querySelector('.gallery-viewer')?.getClientRects().length);
    if (!open()) return Promise.resolve();
    return new Promise((resolve) => {
      function closed() {
        if (open()) return;
        document.removeEventListener('hidden', closed);
        document.removeEventListener('close', closed, true);
        resolve();
      }
      document.addEventListener('hidden', closed);
      document.addEventListener('close', closed, true);
    });
  }

  function localAsset(source) {
    const url = new URL(source, document.baseURI);
    if (url.origin !== location.origin || !url.pathname.startsWith(new URL('assets/', document.baseURI).pathname) ||
        !/\.(jpe?g|png|webp)$/i.test(url.pathname)) return '';
    return url.href;
  }

  async function catalog() {
    const response = await fetch('pictures.html', { credentials: 'omit', cache: 'no-cache', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('Gallery unavailable');
    const page = new DOMParser().parseFromString(await response.text(), 'text/html');
    const photos = new Map();
    page.querySelectorAll('.pictures-grid button[data-photo]').forEach((button) => {
      const image = button.querySelector('img');
      const source = localAsset(button.dataset.photo || '');
      const preview = localAsset(image?.getAttribute('src') || '');
      if (!image || !source || !preview) return;
      photos.set(ratings.photoId(button), { source, preview, title: button.dataset.caption || 'Untitled',
        alt: image.alt, width: image.getAttribute('width'), height: image.getAttribute('height'),
        taken: button.dataset.taken || '', takenLabel: button.dataset.takenLabel || '' });
    });
    return photos;
  }

  function restore() {
    if (!changed) return;
    slots.forEach((slot, index) => resetSlot(slot, originals[index]));
    if (label) label.textContent = originalLabel;
    if (description) description.textContent = originalDescription;
    changed = false;
    document.dispatchEvent(new CustomEvent('gallery:photos-updated'));
  }

  function resetSlot(slot, original) {
    const template = document.createElement('template'); template.innerHTML = original.html;
    // Preserve trigger/image nodes and their viewer event handlers throughout.
    for (const selector of ['button[data-photo]', 'img']) {
      const node = slot.querySelector(selector);
      const source = template.content.querySelector(selector);
      [...node.attributes].forEach((attribute) => node.removeAttribute(attribute.name));
      [...source.attributes].forEach((attribute) => node.setAttribute(attribute.name, attribute.value));
    }
    slot.querySelector('figcaption').innerHTML = template.content.querySelector('figcaption').innerHTML;
    slot.className = original.className;
  }

  function populate(slot, photo, summary, index) {
    // Keep the existing trigger and image nodes so the viewer can refresh its data.
    const button = slot.querySelector('button[data-photo]');
    const image = button.querySelector('img');
    button.dataset.photoId = summary.photoId;
    button.dataset.photo = photo.source;
    button.dataset.caption = photo.title;
    button.dataset.taken = photo.taken;
    button.dataset.takenLabel = photo.takenLabel;
    button.setAttribute('aria-label', `Enlarge ${photo.title} photograph`);
    image.src = photo.preview; image.alt = photo.alt;
    if (photo.width) image.setAttribute('width', photo.width);
    if (photo.height) image.setAttribute('height', photo.height);
    const caption = slot.querySelector('figcaption');
    caption.replaceChildren();
    const title = document.createElement('span');
    const rank = document.createElement('span'); rank.className = 'frame-number'; rank.textContent = `${String(index + 1).padStart(2, '0')} / `;
    title.append(rank, document.createTextNode(photo.title));
    const score = document.createElement('span'); score.className = 'frame-rating'; score.textContent = ratings.averageLabel(summary);
    caption.append(title, score); slot.classList.add('community-frame');
  }

  async function refresh() {
    if (loading) return;
    if (!ratings.configured) { status.textContent = 'A personal selection. Visitor favorites will appear when shared ratings are available.'; return; }
    if (!navigator.onLine) { await whenViewerClosed(); restore(); status.textContent = 'A personal selection · visitor favorites need an internet connection.'; return; }
    loading = true; status.textContent = 'Checking visitor favorites…';
    try {
      const top = await ratings.getTop(slots.length);
      await whenViewerClosed();
      if (!top.length) {
        restore(); status.textContent = 'A personal selection for now. Rate photographs in Pictures to help choose the favorites here.'; return;
      }
      const photos = await catalog();
      await whenViewerClosed();
      const ranked = top.filter((row) => photos.has(row.photoId));
      if (!navigator.onLine) throw new Error('Offline');
      if (!ranked.length) { restore(); status.textContent = 'A personal selection for now. Rate photographs in Pictures to help choose the favorites here.'; return; }
      // Fill any remaining spaces with distinct curated photographs, without a rank.
      restore();
      const ids = new Set(ranked.map((row) => row.photoId));
      const fallback = originals.map((original) => {
        const template = document.createElement('template'); template.innerHTML = original.html;
        return { ...original, id: ratings.photoId(template.content.querySelector('button[data-photo]')) };
      }).filter((original) => !ids.has(original.id));
      slots.forEach((slot, index) => {
        if (ranked[index]) populate(slot, photos.get(ranked[index].photoId), ranked[index], index);
        else {
          const original = fallback.shift();
          if (original) resetSlot(slot, original);
        }
      });
      if (label) label.textContent = 'THROUGH YOUR EYES';
      if (description) description.textContent = 'A few frames chosen by visitors. Rate your favorites in Pictures to help shape what appears here.';
      status.textContent = ranked.length < slots.length ? `${ranked.length} visitor ${ranked.length === 1 ? 'favorite' : 'favorites'}, alongside a personal selection.` : 'Visitor favorites · ranked with a little weight for the number of ratings.';
      changed = true;
      document.dispatchEvent(new CustomEvent('gallery:photos-updated'));
    } catch {
      await whenViewerClosed();
      restore(); status.textContent = 'A personal selection · visitor favorites are temporarily unavailable.';
    } finally { loading = false; }
  }
  refresh();
  window.addEventListener('online', refresh);
  window.addEventListener('offline', refresh);
  window.addEventListener('pageshow', (event) => { if (event.persisted) refresh(); });
})();
