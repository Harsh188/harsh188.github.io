(() => {
  'use strict';
  const STORAGE_KEY = 'folio-photo-ratings-v1';
  const summaries = new Map();
  const widgets = new Set();
  const voteStates = new Map();
  const hosts = new WeakMap();
  const listeners = new Set();
  let stored = readStorage();
  let aggregateState = 'idle';
  let aggregateRequest;
  let aggregateGeneration = 0;
  let voteGeneration = 0;
  const summaryGenerations = new Map();
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

  function refreshStorage() {
    const shared = readStorage();
    // A different (or cleared) identity must not inherit the previous voter's votes.
    stored = shared.voterId && shared.voterId === stored.voterId ?
      { voterId: shared.voterId, votes: { ...stored.votes, ...shared.votes } } : shared;
  }

  function withStorageLock(callback) {
    // Serialize the first ID creation across already-open tabs where supported.
    return navigator.locks?.request ? navigator.locks.request(STORAGE_KEY, callback) : Promise.resolve().then(callback);
  }

  async function voterIdentity() {
    return withStorageLock(() => {
      refreshStorage();
      // Create an anonymous identifier only after the visitor decides to vote.
      if (!stored.voterId) {
        if (typeof crypto.randomUUID !== 'function') throw new Error('This browser cannot save an anonymous rating. Please use an up-to-date browser.');
        const voterId = crypto.randomUUID();
        // Best-effort protection for browsers without Web Locks: another tab may
        // have created the shared identity since our initial storage read.
        refreshStorage();
        if (!stored.voterId) {
          stored.voterId = voterId;
          if (!writeStorage()) {
            stored.voterId = '';
            throw new Error('Allow website storage to save an anonymous rating.');
          }
        }
      }
      return stored.voterId;
    });
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
    const generation = ++aggregateGeneration;
    const votesAtStart = voteGeneration;
    aggregateState = 'loading'; notify();
    const pending = request('/api/ratings').then((data) => {
      const rows = Array.isArray(data) ? data : data.ratings;
      if (!Array.isArray(rows)) throw new Error('Could not read photo ratings. Please try again.');
      if (generation !== aggregateGeneration) return [...summaries.values()];
      const received = new Map(rows.map(cleanSummary).filter(Boolean).map((row) => [row.photoId, row]));
      // A GET started before a successful vote can contain an older snapshot.
      summaries.forEach((row, id) => {
        if ((summaryGenerations.get(id) || 0) > votesAtStart) received.set(id, row);
      });
      summaries.clear();
      received.forEach((row, id) => summaries.set(id, row));
      aggregateState = 'ready'; notify();
      return [...summaries.values()];
    }).catch((error) => {
      if (generation === aggregateGeneration) {
        aggregateState = error.code || (navigator.onLine ? 'unavailable' : 'offline'); notify();
      }
      throw error;
    }).finally(() => { if (aggregateRequest === pending) aggregateRequest = null; });
    aggregateRequest = pending;
    return pending;
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
    const voterId = await voterIdentity();
    const data = await request('/api/ratings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoId: id, rating, voterId }) });
    const row = cleanSummary(data.rating || data);
    if (!row || row.photoId !== id) throw new Error('Could not confirm your rating. Please try again.');
    summaries.set(id, row);
    summaryGenerations.set(id, ++voteGeneration);
    await withStorageLock(() => {
      refreshStorage();
      // Storage may have been cleared while the request was in flight.
      if (stored.voterId !== voterId) return;
      stored.votes[id] = rating;
      writeStorage();
    });
    notify();
    document.dispatchEvent(new CustomEvent('gallery:rating-saved', { detail: row }));
    return row;
  }

  function averageLabel(summary) {
    if (!summary?.count) return 'No ratings yet';
    return `${summary.average.toFixed(1)} / 5 · ${summary.count} ${summary.count === 1 ? 'rating' : 'ratings'}`;
  }

  function voteState(id) {
    if (!voteStates.has(id)) voteStates.set(id, { pending: 0, saving: false, failed: false, message: '', retryUntil: 0 });
    return voteStates.get(id);
  }

  function render(widget) {
    if (!widget.id) return;
    const state = voteState(widget.id);
    const own = stored.votes[widget.id];
    const selected = state.pending || own || 0;
    widget.buttons.forEach((button, index) => {
      button.setAttribute('aria-checked', String(index + 1 === selected));
      button.classList.toggle('is-filled', index < selected);
      button.tabIndex = index + 1 === (selected || 1) ? 0 : -1;
      button.disabled = state.saving || Date.now() < state.retryUntil || !apiBase || !navigator.onLine;
    });
    widget.group.setAttribute('aria-busy', String(state.saving));
    widget.summary.textContent = summaries.has(widget.id) ? averageLabel(summaries.get(widget.id)) + (!navigator.onLine ? ' · last loaded' : '') :
      aggregateState === 'loading' ? 'Loading ratings…' : aggregateState === 'ready' ? 'No ratings yet' :
        !apiBase ? 'Shared ratings unavailable' : !navigator.onLine ? 'Ratings unavailable offline' : 'Ratings temporarily unavailable';
    widget.status.textContent = !navigator.onLine ? 'Connect to save a rating.' :
      !apiBase ? 'Ratings are not available right now.' : state.message || (own ? `Your rating: ${own} / 5 · change it anytime` : 'Choose 1–5 stars');
    widget.retry.hidden = !state.failed || state.saving || !navigator.onLine || !apiBase;
    widget.retry.disabled = Date.now() < state.retryUntil;
    widget.fieldset.dataset.state = state.failed ? 'error' : state.saving ? 'saving' : !navigator.onLine ? 'offline' : 'ready';
  }

  async function save(id, rating) {
    const state = voteState(id);
    if (state.saving || Date.now() < state.retryUntil) return;
    // Capture the photo ID and its state before awaiting. The viewer may advance
    // to another photograph while this request is still running.
    state.pending = rating; state.message = 'Saving your rating…'; state.saving = true; state.failed = false; notify();
    try {
      await vote(id, rating);
      state.pending = 0; state.message = stored.votes[id] === rating ? `Saved · your rating: ${rating} / 5` : '';
    } catch (error) {
      state.failed = true; state.message = error.message;
      if (error.status === 429 && error.retrySeconds) {
        const delay = Math.min(error.retrySeconds, 3600) * 1000;
        state.retryUntil = Date.now() + delay;
        setTimeout(() => { state.message = 'You can try saving your rating again.'; notify(); }, delay + 20);
      }
    }
    finally { state.saving = false; notify(); }
  }

  function cancelKeyboardChoice(widget) {
    if (!widget.keyboardTimer) return;
    clearTimeout(widget.keyboardTimer); widget.keyboardTimer = null;
    const state = voteState(widget.id);
    if (!state.saving && !state.failed) state.pending = 0;
  }

  function createWidget(host) {
    const fieldset = document.createElement('div'); fieldset.className = 'photo-rating';
    const legend = document.createElement('span'); legend.className = 'rating-label'; legend.textContent = 'Your rating';
    const group = document.createElement('div'); group.className = 'rating-stars'; group.setAttribute('role', 'radiogroup');
    const summary = document.createElement('p'); summary.className = 'rating-summary';
    const status = document.createElement('p'); status.className = 'rating-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'rating-retry'; retry.textContent = 'Try again'; retry.hidden = true;
    const info = document.createElement('details'); info.className = 'rating-info';
    const infoLabel = document.createElement('summary'); infoLabel.textContent = 'About ratings';
    const disclosure = document.createElement('p');
    disclosure.textContent = 'Your favorites help choose the photographs on my Me page. No sign-in: a random browser ID remembers your votes, and a temporary IP hash limits rapid voting. An internet connection is needed to save.';
    info.append(infoLabel, disclosure);
    const buttons = Array.from({ length: 5 }, (_, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = '☆'; button.setAttribute('role', 'radio');
      button.setAttribute('aria-label', `${index + 1} ${index ? 'stars' : 'star'}`);
      group.append(button); return button;
    });
    fieldset.append(legend, group, status, summary, retry, info); host.replaceChildren(fieldset);
    const widget = { host, id: '', fieldset, group, buttons, summary, status, retry, info, keyboardTimer: null };
    widgets.add(widget); hosts.set(host, widget);
    buttons.forEach((button, index) => {
      button.addEventListener('click', () => { cancelKeyboardChoice(widget); save(widget.id, index + 1); });
      button.addEventListener('keydown', (event) => {
        const steps = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
        if (!(event.key in steps) && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault(); event.stopPropagation();
        if (button.disabled) return;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 4 : (index + steps[event.key] + 5) % 5;
        const id = widget.id;
        const state = voteState(id);
        state.pending = next + 1; state.message = ''; state.failed = false; render(widget); buttons[next].focus();
        clearTimeout(widget.keyboardTimer);
        widget.keyboardTimer = setTimeout(() => { widget.keyboardTimer = null; save(id, next + 1); }, 400);
      });
    });
    retry.addEventListener('click', () => {
      const state = voteState(widget.id);
      if (state.failed && state.pending) save(widget.id, state.pending);
    });
    return widget;
  }

  function mountViewer(host, detail = {}) {
    if (!host) return null;
    const id = detail.photoId || (detail.trigger && photoId(detail.trigger)) || host.closest('[data-photo-id]')?.dataset.photoId;
    if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(id || '')) return null;
    const widget = hosts.get(host) || createWidget(host);
    if (widget.id !== id) {
      cancelKeyboardChoice(widget);
      widget.info.open = false;
      widget.id = id;
    }
    host.dataset.photoId = id;
    widget.group.setAttribute('aria-label', `Rate ${detail.title || detail.trigger?.dataset.caption || 'this photograph'}`);
    render(widget);
    if (apiBase && aggregateState === 'idle') getSummaries().catch(() => {});
    return widget.fieldset;
  }

  function discoverViewer() {
    document.querySelectorAll('[data-viewer-rating]').forEach((host) => mountViewer(host));
  }

  window.PhotoRatings = Object.freeze({ getSummaries, getTop, vote, photoId, averageLabel,
    mountViewer, getOwnRating: (id) => stored.votes[id] || 0,
    configured: Boolean(apiBase), subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } });
  discoverViewer();
  document.addEventListener('gallery:viewer-photo', (event) => mountViewer(event.detail?.host, event.detail));
  document.addEventListener('gallery:viewer-ready', discoverViewer);
  document.addEventListener('gallery:viewer-hidden', () => widgets.forEach(cancelKeyboardChoice));
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    refreshStorage();
    widgets.forEach(cancelKeyboardChoice);
    voteStates.forEach((state) => {
      if (!state.saving) { state.pending = 0; state.message = ''; state.failed = false; }
    });
    notify();
  });
  window.addEventListener('offline', () => { aggregateState = 'offline'; notify(); });
  window.addEventListener('online', () => { notify(); if (widgets.size && apiBase) getSummaries(true).catch(() => {}); });
})();
