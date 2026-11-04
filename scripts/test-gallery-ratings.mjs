// Run the production ratings client in separate tab contexts with shared storage.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../portfolio/gallery-ratings.js', import.meta.url), 'utf8');
const storageKey = 'folio-photo-ratings-v1';
const identityA = '12345678-1234-4123-8123-123456789abc';
const identityB = 'abcdef12-1234-4123-8123-123456789abc';
const row = (photoId, average, count = 1) => ({ photoId, average, count, score: average });
const json = (body) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function environment() {
  const data = new Map();
  let queue = Promise.resolve();
  return {
    storage: { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), clear: () => data.clear() },
    locks: { request(_name, callback) {
      const result = queue.then(callback);
      queue = result.catch(() => {});
      return result;
    } },
  };
}

// Minimal DOM surfaces used by the real client, so the tests exercise event
// wiring and visible state without adding a browser package to this static site.
function fakeDocument() {
  const listeners = new Map();
  const doc = {
    querySelectorAll: () => [],
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatchEvent(event) { listeners.get(event.type)?.forEach((listener) => listener(event)); },
    createElement(tag) {
      const attributes = new Map();
      const events = new Map();
      const classes = new Set();
      const node = {
        tagName: tag.toUpperCase(), children: [], dataset: {}, textContent: '', hidden: false, disabled: false,
        classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }, contains: (name) => classes.has(name) },
        setAttribute: (name, value) => attributes.set(name, value), getAttribute: (name) => attributes.get(name),
        append(...children) { node.children.push(...children); },
        replaceChildren(...children) { node.children = children; },
        closest: () => null,
        focus() { doc.activeElement = node; },
        addEventListener(type, listener) {
          if (!events.has(type)) events.set(type, []);
          events.get(type).push(listener);
        },
        fire(type, detail = {}) { events.get(type)?.forEach((listener) => listener(detail)); },
      };
      return node;
    },
  };
  return doc;
}

function tab(shared, { fetch, uuid = () => identityA, locks = true } = {}) {
  const events = new Map();
  const window = {
    PHOTO_RATINGS_CONFIG: { API_BASE: 'https://ratings.test' },
    addEventListener(name, listener) {
      if (!events.has(name)) events.set(name, []);
      events.get(name).push(listener);
    },
  };
  const document = fakeDocument();
  const navigator = { onLine: true, ...(locks ? { locks: shared.locks } : {}) };
  const context = vm.createContext({
    window, navigator, document,
    localStorage: shared.storage, crypto: { randomUUID: uuid }, fetch, URL, AbortController,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    setTimeout, clearTimeout,
  });
  vm.runInContext(source, context);
  return { api: window.PhotoRatings, document, navigator, event: (name, value) => events.get(name)?.forEach((listener) => listener(value)) };
}

{
  const shared = environment();
  const posts = [];
  const fetch = async (_url, options) => {
    const body = JSON.parse(options.body); posts.push(body);
    return json({ rating: row(body.photoId, body.rating), yourRating: body.rating });
  };
  // Both tabs initialize before any vote, and no storage event is delivered yet.
  const first = tab(shared, { fetch });
  const second = tab(shared, { fetch, uuid: () => identityB });
  assert.equal(shared.storage.getItem(storageKey), null, 'loading the page must not create an identity');
  await Promise.all([first.api.vote('rooted', 5), second.api.vote('wire', 4)]);
  assert.equal(new Set(posts.map((body) => body.voterId)).size, 1);
  assert.deepEqual(JSON.parse(shared.storage.getItem(storageKey)).votes, { rooted: 5, wire: 4 });
  // A tab with stale memory must merge the other tab's votes before persisting.
  await first.api.vote('easy-smile', 3);
  assert.deepEqual(JSON.parse(shared.storage.getItem(storageKey)).votes, { rooted: 5, wire: 4, 'easy-smile': 3 });
  let notifications = 0;
  first.api.subscribe(() => { notifications++; });
  first.event('storage', { key: storageKey });
  assert.equal(notifications, 1, 'another tab\'s vote must rerender the current tab');
  assert.equal(new Set(posts.map((body) => body.voterId)).size, 1);
  console.log('PASS: already-open tabs share one identity and merge their votes under Web Locks.');
}

{
  const shared = environment();
  let payload;
  const visitor = tab(shared, { locks: false, uuid() {
    // Another tab creates the identity between the first read and UUID creation.
    shared.storage.setItem(storageKey, JSON.stringify({ voterId: identityB, votes: { wire: 4 } }));
    return identityA;
  }, fetch: async (_url, options) => {
    payload = JSON.parse(options.body);
    return json({ rating: row(payload.photoId, payload.rating) });
  } });
  await visitor.api.vote('rooted', 5);
  assert.equal(payload.voterId, identityB);
  assert.deepEqual(JSON.parse(shared.storage.getItem(storageKey)).votes, { wire: 4, rooted: 5 });
  console.log('PASS: browsers without Web Locks reread an identity created by another tab.');
}

{
  const shared = environment();
  const pendingGet = deferred();
  const visitor = tab(shared, { fetch: async (_url, options) => options.method === 'POST' ?
    json({ rating: row('rooted', 5, 2) }) : pendingGet.promise });
  const aggregate = visitor.api.getSummaries();
  await visitor.api.vote('rooted', 5);
  pendingGet.resolve(json({ ratings: [row('rooted', 1), row('wire', 4)] }));
  await aggregate;
  const summaries = await visitor.api.getSummaries();
  assert.equal(summaries.find((value) => value.photoId === 'rooted').average, 5);
  assert.equal(summaries.find((value) => value.photoId === 'rooted').count, 2);
  assert.equal(summaries.find((value) => value.photoId === 'wire').average, 4);
  console.log('PASS: a stale GET preserves a newer successful vote and loads other photo summaries.');
}

{
  const shared = environment();
  const older = deferred();
  const newer = deferred();
  let gets = 0;
  const visitor = tab(shared, { fetch: () => (++gets === 1 ? older : newer).promise });
  const first = visitor.api.getSummaries();
  const second = visitor.api.getSummaries(true);
  newer.resolve(json({ ratings: [row('rooted', 5, 2)] }));
  await second;
  older.resolve(json({ ratings: [row('rooted', 1)] }));
  await first;
  assert.equal((await visitor.api.getSummaries())[0].average, 5);
  console.log('PASS: an older forced aggregate refresh cannot replace a newer refresh.');
}

{
  const shared = environment();
  const pending = deferred();
  const visitor = tab(shared, { fetch: () => pending.promise });
  const vote = visitor.api.vote('rooted', 5);
  // Let identity initialization and fetch start before storage is cleared.
  await new Promise((resolve) => setImmediate(resolve));
  shared.storage.clear();
  visitor.event('storage', { key: null });
  pending.resolve(json({ rating: row('rooted', 5) }));
  await vote;
  assert.equal(shared.storage.getItem(storageKey), null, 'a late response must not resurrect a cleared identity');
  console.log('PASS: clearing browser storage during a vote does not restore the removed identity.');
}


const flush = () => new Promise((resolve) => setImmediate(resolve));
function viewerWidget(visitor, host, id, title = id) {
  visitor.document.dispatchEvent({ type: 'gallery:viewer-photo', detail: { host, photoId: id, title } });
  const fieldset = host.children[0];
  const byClass = (name) => fieldset.children.find((node) => node.className === name);
  return { fieldset, stars: byClass('rating-stars').children, status: byClass('rating-status'),
    summary: byClass('rating-summary'), retry: byClass('rating-retry'), group: byClass('rating-stars') };
}

{
  const shared = environment();
  const pending = deferred();
  const posts = [];
  const visitor = tab(shared, { fetch: (_url, options) => {
    if (options.method !== 'POST') return Promise.resolve(json({ ratings: [] }));
    posts.push(JSON.parse(options.body)); return pending.promise;
  } });
  const host = visitor.document.createElement('div');
  let widget = viewerWidget(visitor, host, 'rooted', 'Rooted');
  await flush();
  assert.equal(shared.storage.getItem(storageKey), null, 'opening a viewer must not create an anonymous identity');
  assert.equal(widget.group.getAttribute('aria-label'), 'Rate Rooted');
  widget.stars[3].fire('click');
  await flush();
  assert.equal(widget.status.textContent, 'Saving your rating…');
  widget = viewerWidget(visitor, host, 'wire', 'Wire');
  assert.equal(widget.group.getAttribute('aria-label'), 'Rate Wire');
  assert.equal(widget.status.textContent, 'Choose 1–5 stars');
  assert.equal(widget.stars.some((button) => button.disabled), false);
  pending.resolve(json({ rating: row('rooted', 4), yourRating: 4 }));
  await flush();
  assert.equal(widget.status.textContent, 'Choose 1–5 stars', 'an earlier response must not overwrite the current photo status');
  assert.equal(widget.stars.some((button) => button.getAttribute('aria-checked') === 'true'), false);
  assert.equal(visitor.api.getOwnRating('rooted'), 4);
  assert.equal(visitor.api.getOwnRating('wire'), 0);
  widget = viewerWidget(visitor, host, 'rooted');
  assert.match(widget.status.textContent, /Saved.*4 \/ 5/);
  assert.equal(widget.stars[3].getAttribute('aria-checked'), 'true');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].photoId, 'rooted');
  console.log('PASS: the viewer changes target immediately while an earlier photo vote saves independently.');
}

{
  const shared = environment();
  const pending = deferred();
  const posts = [];
  const visitor = tab(shared, { fetch: (_url, options) => {
    if (options.method !== 'POST') return Promise.resolve(json({ ratings: [] }));
    const payload = JSON.parse(options.body); posts.push(payload);
    return posts.length === 1 ? pending.promise : Promise.resolve(json({ rating: row(payload.photoId, payload.rating) }));
  } });
  const host = visitor.document.createElement('div');
  let widget = viewerWidget(visitor, host, 'rooted');
  await flush(); widget.stars[1].fire('click'); await flush();
  widget = viewerWidget(visitor, host, 'wire');
  pending.resolve(new Response('{}', { status: 503 })); await flush();
  assert.equal(widget.retry.hidden, true);
  assert.equal(widget.status.textContent, 'Choose 1–5 stars');
  widget = viewerWidget(visitor, host, 'rooted');
  assert.equal(widget.retry.hidden, false);
  assert.match(widget.status.textContent, /not been saved/);
  widget.retry.fire('click'); await flush();
  assert.deepEqual(posts.map(({ photoId, rating }) => ({ photoId, rating })), [
    { photoId: 'rooted', rating: 2 }, { photoId: 'rooted', rating: 2 },
  ]);
  assert.equal(widget.retry.hidden, true);
  assert.equal(visitor.api.getOwnRating('wire'), 0);
  console.log('PASS: failure and retry remain attached to the original photo after navigating away and back.');
}

{
  const shared = environment();
  const posts = [];
  const visitor = tab(shared, { fetch: async (_url, options) => {
    if (options.method !== 'POST') return json({ ratings: [] });
    const payload = JSON.parse(options.body); posts.push(payload);
    return json({ rating: row(payload.photoId, payload.rating) });
  } });
  const host = visitor.document.createElement('div');
  let widget = viewerWidget(visitor, host, 'rooted'); await flush();
  let prevented = false, stopped = false;
  widget.stars[0].fire('keydown', { key: 'ArrowRight', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(prevented && stopped, true, 'rating arrows must not advance the photo');
  assert.equal(widget.stars[1].tabIndex, 0);
  assert.equal(visitor.document.activeElement, widget.stars[1]);
  widget = viewerWidget(visitor, host, 'wire');
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.equal(posts.length, 0, 'leaving a photo cancels its unsubmitted keyboard choice');
  widget.stars[0].fire('keydown', { key: 'End', preventDefault() {}, stopPropagation() {} });
  await new Promise((resolve) => setTimeout(resolve, 450)); await flush();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].photoId, 'wire'); assert.equal(posts[0].rating, 5);
  assert.equal(widget.stars.filter((button) => button.tabIndex === 0).length, 1);
  visitor.navigator.onLine = false; visitor.event('offline');
  assert.equal(widget.stars.every((button) => button.disabled), true);
  assert.match(widget.status.textContent, /Connect to save/);
  await assert.rejects(visitor.api.vote('rooted', 3), /offline/);
  assert.equal(posts.length, 1, 'offline attempts are not queued or submitted');
  console.log('PASS: keyboard stars keep one tab stop, do not navigate photos, and offline voting stays unavailable.');
}
