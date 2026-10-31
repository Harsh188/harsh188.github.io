(() => {
  const panel = document.querySelector('.gallery-offline');
  const button = panel?.querySelector('.offline-save');
  const remove = panel?.querySelector('.offline-remove');
  const label = panel?.querySelector('.offline-status');
  const progress = panel?.querySelector('progress');
  let worker, manifest, saved, busy = false;
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;

  function request(type, data = {}, onProgress) {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      let timeout;
      const resetTimeout = () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => { channel.port1.close(); reject(new Error('Download paused. Reopen this page and retry.')); }, 60000);
      };
      channel.port1.onmessage = ({ data: result }) => {
        resetTimeout();
        if (result.type === 'progress') onProgress?.(result);
        else {
          clearTimeout(timeout); channel.port1.close();
          if (result.type === 'error') reject(Object.assign(new Error(result.message), { saved: result.saved }));
          else resolve(result);
        }
      };
      resetTimeout(); worker.postMessage({ type, ...data }, [channel.port2]);
    });
  }
  function render(message) {
    if (!panel) return;
    const ready = saved?.saved && (!manifest || saved.revision === manifest.revision);
    button.disabled = busy || !manifest || !navigator.onLine || ready;
    button.textContent = busy ? 'Saving gallery…' : ready ? 'Saved offline ✓' : saved?.saved ? 'Update offline gallery' : `Save gallery offline · ${Math.ceil(manifest?.totalBytes / 1e6 || 25)} MB`;
    remove.hidden = !saved?.saved; remove.disabled = busy;
    progress.hidden = !busy;
    label.textContent = message || (ready ? `${saved.photoCount} photos ready offline on this device.` : saved?.saved ? 'Your saved gallery is available. New edits are ready to download.' : 'Save once on a good connection to view without signal.');
  }
  async function save(userInitiated = false) {
    if (busy || !manifest) return;
    busy = true;
    if (progress) progress.value = 0;
    render('Preparing your offline gallery…');
    // Browsers decide whether persistence is granted; downloading works either way.
    if (userInitiated) navigator.storage?.persist?.().catch(() => {});
    try {
      saved = await request('SAVE', { manifest }, (result) => {
        if (progress) progress.value = result.completedBytes / result.totalBytes;
        render(`Saving ${Math.round(result.completedBytes / result.totalBytes * 100)}% · keep this page open.`);
      });
      busy = false; render();
    } catch (error) {
      busy = false;
      saved = await request('STATUS').catch(() => ({ saved: false }));
      render(`${saved.saved ? 'Your previous offline gallery is still available. ' : ''}${error.message} Retry on a good connection.`);
    }
  }
  async function refresh() {
    if (!worker || busy) return;
    try {
      const response = await fetch('gallery-manifest.json', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('Manifest unavailable');
      manifest = await response.json();
    } catch (_) { /* The saved catalog is sufficient to open the offline gallery. */ }
    saved = await request('STATUS', { manifest });
    render();
    if (saved.saved && manifest && saved.revision !== manifest.revision && navigator.onLine) await save();
  }
  button?.addEventListener('click', () => save(true));
  remove?.addEventListener('click', async () => {
    if (busy) return;
    saved = await request('REMOVE'); render('Offline copy removed from this device.');
  });
  window.addEventListener('online', refresh);
  window.addEventListener('offline', () => render(busy ? 'Connection lost. Waiting for the download to finish or pause…' : undefined));
  (async () => {
    try {
      const registration = await navigator.serviceWorker.register('gallery-sw.js', { updateViaCache: 'none' });
      await navigator.serviceWorker.ready;
      worker = registration.active;
      if (panel) panel.hidden = false;
      await refresh();
    } catch (_) {
      if (panel) { panel.hidden = false; button.disabled = true; label.textContent = 'Offline saving is unavailable in this browser session.'; }
    }
  })();
})();
