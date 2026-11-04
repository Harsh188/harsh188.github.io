(() => {
  const collections = Array.from(document.querySelectorAll('details.gallery-collection'));
  if (!collections.length) return;

  const controls = document.querySelector('.collection-controls');
  const status = document.querySelector('.collection-status');
  const expand = controls?.querySelector('[data-collections-action="expand"]');
  const collapse = controls?.querySelector('[data-collections-action="collapse"]');

  function updateControls() {
    const opened = collections.filter((collection) => collection.open).length;
    if (expand) expand.disabled = opened === collections.length;
    if (collapse) collapse.disabled = opened === 0;
    if (status) status.textContent = `${opened} of ${collections.length} collections open`;
  }

  function revealFragment() {
    if (!location.hash) return;
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); }
    catch { return; }
    const target = document.getElementById(id);
    const collection = target?.closest('details.gallery-collection');
    if (!collection) return;
    collection.open = true;
    updateControls();
    // Wait until the newly opened frames have a layout before positioning the link.
    requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
  }

  collections.forEach((collection) => collection.addEventListener('toggle', updateControls));
  controls?.addEventListener('click', (event) => {
    const action = event.target.closest('button[data-collections-action]')?.dataset.collectionsAction;
    if (!action) return;
    collections.forEach((collection) => { collection.open = action === 'expand'; });
    updateControls();
  });
  if (controls) controls.hidden = false;
  window.addEventListener('hashchange', revealFragment);
  updateControls();
  revealFragment();
})();
