(() => {
  'use strict';
  const STORAGE_KEY = 'folio-photo-ratings-v1';
  const summaries = new Map();
  const widgets = new Map();
  const listeners = new Set();
  let stored = readStorage();
  let aggregateState = 'idle';
  let aggregateRequest;
  let apiBase = String(window.PHOTO_RATINGS_CONFIG?.API_BASE || '').replace(/\/+$/, '');
  try {
    const endpoint = new URL(apiBase);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
    if (endpoint.protocol !== 'https:' && !(local && endpoint.protocol === 'http:')) apiBase = '';
  } catch { apiBase = ''; }

  function readStorage() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      const voterId = /^[a-f0-9-]{36}$/i.test(value.voterId || '') ? value.voterId : '';
      const votes = Object.fromEntries(Object.entries(value.votes || {})
        .filter(([id, rating]) => /^[a-z0-9][a-z0-9-]{0,99}$/.test(id) && Number.isInteger(rating) && rating >= 1 && rating <= 5));
      return { voterId, votes };
    } catch { return { voterId: '', votes: {} }; }
  }

  function writeStorage() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stored)); return true; }
    catch { return false; }
  }

  function photoId(trigger) {
    const source = trigger.dataset.photo || '';
    return trigger.dataset.photoId || source.split('/').pop().split('?')[0]
      .replace(/\.[^.]+$/, '').replace(/-v\d+$/, '');
  }

  function cleanSummary(value) {
    if (!value || typeof value.photoId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(value.photoId) ||
        !Number.isInteger(value.count) || value.count < 0 || !Number.isFinite(value.average) || value.average < 0 || value.average > 5) return null;
    return { photoId: value.photoId, count: value.count, average: value.average,
      score: Number.isFinite(value.score) ? value.score : value.average };
  }

  async function request(path, options = {}) {
    if (!apiBase) throw Object.assign(new Error('Photo ratings are not available yet.'), { code: 'unconfigured' });
    if (!navigator.onLine) throw Object.assign(new Error('Connect to the internet to rate photographs.'), { code: 'offline' });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${apiBase}${path}`, { mode: 'cors', credentials: 'omit', cache: 'no-store',
        referrerPolicy: 'no-referrer', ...options, signal: controller.signal });
      if (!response.ok) {
        const retryAfter = response.headers.get('Retry-After');
        const retrySeconds = /^\d+$/.test(retryAfter || '') ? Number(retryAfter) :
          Math.max(0, Math.ceil((Date.parse(retryAfter || '') - Date.now()) / 1000)) || 0;
        let message = 'Ratings are temporarily unavailable. Please try again.';
        if (response.status === 429) message = retrySeconds ?
          `Too many ratings just now. Try again in ${retrySeconds} seconds.` : 'Too many ratings just now. Please wait a moment and try again.';
        if (response.status === 503) message = 'Ratings are temporarily unavailable. Your rating has not been saved.';
        throw Object.assign(new Error(message), { status: response.status, retrySeconds });
      }
      return await response.json();
    } catch (error) {
      if (error.status || error.code) throw error;
      throw new Error(navigator.onLine ? 'Could not reach photo ratings. Please try again.' : 'You’re offline. Connect to save your rating.');
    } finally { clearTimeout(timeout); }
  }

  function notify() {
    widgets.forEach((widget) => render(widget));
    listeners.forEach((listener) => listener());
  }

  async function getSummaries(force = false) {
    if (aggregateRequest && !force) return aggregateRequest;
    if (aggregateState === 'ready' && !force) return [...summaries.values()];
    aggregateState = 'loading'; notify();
    aggregateRequest = request('/api/ratings').then((data) => {
      const rows = Array.isArray(data) ? data : data.ratings;
      if (!Array.isArray(rows)) throw new Error('Could not read photo ratings. Please try again.');
      summaries.clear();
      rows.map(cleanSummary).filter(Boolean).forEach((row) => summaries.set(row.photoId, row));
      aggregateState = 'ready'; notify();
      return [...summaries.values()];
    }).catch((error) => {
      aggregateState = error.code || (navigator.onLine ? 'unavailable' : 'offline'); notify(); throw error;
    }).finally(() => { aggregateRequest = null; });
    return aggregateRequest;
  }

  async function getTop(limit = 4) {
    const data = await request(`/api/top?limit=${Math.max(1, Math.min(12, limit))}`);
    const rows = Array.isArray(data) ? data : data.ratings;
    if (!Array.isArray(rows)) throw new Error('Could not read visitor favorites.');
    return rows.map(cleanSummary).filter((row) => row && row.count > 0);
  }

  async function vote(id, rating) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error('Choose a rating from 1 to 5.');
    if (!apiBase) throw Object.assign(new Error('Photo ratings are not available yet.'), { code: 'unconfigured' });
    if (!navigator.onLine) throw Object.assign(new Error('You’re offline. Connect to save your rating.'), { code: 'offline' });
    // Create an anonymous identifier only after the visitor decides to vote.
    if (!stored.voterId) {
      if (typeof crypto.randomUUID !== 'function') throw new Error('This browser cannot save an anonymous rating. Please use an up-to-date browser.');
      stored.voterId = crypto.randomUUID();
      if (!writeStorage()) {
        stored.voterId = '';
        throw new Error('Allow website storage to save an anonymous rating.');
      }
    }
    const data = await request('/api/ratings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoId: id, rating, voterId: stored.voterId }) });
    const row = cleanSummary(data.rating || data);
    if (!row || row.photoId !== id) throw new Error('Could not confirm your rating. Please try again.');
    summaries.set(id, row);
    stored.votes[id] = rating;
    writeStorage(); notify();
    document.dispatchEvent(new CustomEvent('gallery:rating-saved', { detail: row }));
    return row;
  }

  function averageLabel(summary) {
    if (!summary?.count) return 'No ratings yet';
    return `${summary.average.toFixed(1)} / 5 · ${summary.count} ${summary.count === 1 ? 'rating' : 'ratings'}`;
  }

  function render(widget) {
    const own = stored.votes[widget.id];
    const selected = widget.pending || own || 0;
    widget.buttons.forEach((button, index) => {
      button.setAttribute('aria-checked', String(index + 1 === selected));
      button.classList.toggle('is-filled', index < selected);
      button.tabIndex = index + 1 === (selected || 1) ? 0 : -1;
      button.disabled = widget.saving || Date.now() < (widget.retryUntil || 0) || !apiBase || !navigator.onLine;
    });
    widget.group.setAttribute('aria-busy', String(widget.saving));
    widget.summary.textContent = summaries.has(widget.id) ? averageLabel(summaries.get(widget.id)) + (!navigator.onLine ? ' · last loaded' : '') :
      aggregateState === 'loading' ? 'Loading ratings…' : aggregateState === 'ready' ? 'No ratings yet' :
        !apiBase ? 'Shared ratings are not available yet' : !navigator.onLine ? 'Ratings unavailable offline' : 'Ratings unavailable';
    widget.status.textContent = widget.message || (own ? `Your rating: ${own} / 5 · you can change it` : 'Choose 1–5 stars');
    widget.retry.hidden = !widget.failed || widget.saving || !navigator.onLine || !apiBase;
    widget.retry.disabled = Date.now() < (widget.retryUntil || 0);
    widget.fieldset.dataset.state = widget.failed ? 'error' : widget.saving ? 'saving' : 'ready';
  }

  async function save(widget, rating) {
    if (widget.saving || Date.now() < (widget.retryUntil || 0)) return;
    clearTimeout(widget.keyboardTimer);
    widget.pending = rating; widget.message = 'Saving your rating…'; widget.saving = true; widget.failed = false; render(widget);
    try {
      await vote(widget.id, rating);
      widget.pending = 0; widget.message = `Saved · your rating: ${rating} / 5. You can change it.`;
    } catch (error) {
      widget.failed = true; widget.message = error.message;
      if (error.status === 429 && error.retrySeconds) {
        const delay = Math.min(error.retrySeconds, 3600) * 1000;
        widget.retryUntil = Date.now() + delay;
        setTimeout(() => { widget.message = 'You can try saving your rating again.'; render(widget); }, delay + 20);
      }
    }
    finally { widget.saving = false; render(widget); }
  }

  function addWidget(trigger) {
    const figure = trigger.closest('.photo-print');
    const id = photoId(trigger);
    if (!figure || !id || figure.querySelector('.photo-rating')) return;
    const title = trigger.dataset.caption || 'Untitled photograph';
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'photo-rating';
    const legend = document.createElement('legend'); legend.textContent = 'Your eye, your vote';
    const group = document.createElement('div'); group.className = 'rating-stars'; group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', `Rate ${title}`);
    const summary = document.createElement('p'); summary.className = 'rating-summary';
    const status = document.createElement('p'); status.className = 'rating-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'rating-retry'; retry.textContent = 'Try again'; retry.hidden = true;
    const buttons = Array.from({ length: 5 }, (_, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = '☆'; button.setAttribute('role', 'radio');
      button.setAttribute('aria-label', `${index + 1} ${index ? 'stars' : 'star'}`);
      group.append(button); return button;
    });
    fieldset.append(legend, group, summary, status, retry); figure.append(fieldset);
    const widget = { id, fieldset, group, buttons, summary, status, retry, saving: false, pending: 0, failed: false, message: '' };
    widgets.set(id, widget);
    buttons.forEach((button, index) => {
      button.addEventListener('click', () => save(widget, index + 1));
      button.addEventListener('keydown', (event) => {
        const steps = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
        if (!(event.key in steps) && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 4 : (index + steps[event.key] + 5) % 5;
        widget.pending = next + 1; widget.message = ''; widget.failed = false; render(widget); buttons[next].focus();
        clearTimeout(widget.keyboardTimer); widget.keyboardTimer = setTimeout(() => save(widget, next + 1), 400);
      });
    });
    retry.addEventListener('click', () => save(widget, widget.pending || stored.votes[id] || 5));
    render(widget);
  }

  function initializeGallery() {
    const galleries = document.querySelectorAll('.pictures-grid');
    if (!galleries.length) return;
    if (!document.querySelector('.ratings-intro')) {
      const note = document.createElement('aside'); note.className = 'ratings-intro';
      note.innerHTML = '<p><strong>Which frames stay with you?</strong> Rate a photograph to help choose the favorites on my Me page. No sign-in; you can change your vote.</p><p class="ratings-privacy">Voting saves an anonymous ID in this browser. The ratings service uses a protected network identifier to limit repeat voting. Ratings need an internet connection.</p>';
      const firstGallery = galleries[0];
      const collection = firstGallery.closest('details');
      (collection?.parentElement?.closest('section') || collection || firstGallery).before(note);
    }
    document.querySelectorAll('.pictures-grid button[data-photo]').forEach(addWidget);
    if (apiBase) getSummaries().catch(() => {});
  }

  window.PhotoRatings = Object.freeze({ getSummaries, getTop, vote, photoId, averageLabel,
    configured: Boolean(apiBase), subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } });
  initializeGallery();
  document.addEventListener('gallery:photos-updated', initializeGallery);
  window.addEventListener('offline', () => { aggregateState = 'offline'; notify(); });
  window.addEventListener('online', () => { notify(); if (widgets.size && apiBase) getSummaries(true).catch(() => {}); });
})();
