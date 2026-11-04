(() => {
  const page = document.querySelector('.pictures-page');
  const navigation = document.querySelector('.gallery-views');
  const collections = Array.from(document.querySelectorAll('details.gallery-collection'));
  if (!page || !navigation || !collections.length) return;

  const buttons = Array.from(navigation.querySelectorAll('button[data-gallery-view]'));
  const note = navigation.querySelector('.gallery-view-note');
  const gallery = document.querySelector('.gallery-archive');
  const notes = {
    selected: 'A few frames, in conversation.',
    collections: 'Little stories, unfolding.',
    all: 'In the order they were taken.',
  };
  let mode = 'all';
  // Preserve collection choices when switching to an ungrouped view.
  const opened = new Set();

  function showView(next, focus = false) {
    if (!Object.hasOwn(notes, next)) return;
    if (mode === 'collections') {
      collections.forEach((collection) => {
        if (collection.open) opened.add(collection.id);
        else opened.delete(collection.id);
      });
    }
    mode = next;
    page.dataset.galleryView = mode;
    buttons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.galleryView === mode)));
    collections.forEach((collection) => { collection.open = mode === 'collections' ? opened.has(collection.id) : true; });
    if (note) note.textContent = notes[mode];
    if (gallery) gallery.setAttribute('aria-label', mode === 'selected' ? 'Selected photographs' : mode === 'collections' ? 'Photographic collections' : 'All photographs, newest first');
    if (focus) buttons.find((button) => button.dataset.galleryView === mode)?.focus();
  }

  function revealFragment() {
    if (!location.hash) return false;
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); }
    catch { return false; }
    const target = document.getElementById(id);
    if (!target || !gallery?.contains(target)) return false;
    const collection = target.closest('details.gallery-collection');
    // Collection links open their chapter. Photograph links reveal the complete archive.
    if (target.matches('details.gallery-collection')) {
      showView('collections');
      target.open = true;
    } else {
      showView('all');
      if (collection) collection.open = true;
    }
    requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
    return true;
  }

  navigation.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-gallery-view]');
    if (!button) return;
    showView(button.dataset.galleryView);
  });
  window.addEventListener('hashchange', revealFragment);
  navigation.hidden = false;
  if (!revealFragment()) showView('selected');
})();
